"""Price Monitor Bot — interface web (Flask)."""

from __future__ import annotations

import hmac
import logging
import os
import re
import uuid
from functools import wraps

from flask import Flask, g, jsonify, render_template, request

import monitor
import notifier
import scraper
from storage import UserRepository, create_store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder="static")
repo = UserRepository(create_store())

COOKIE_NAME = "uid"
COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2  # 2 anos
MAX_PRODUCTS = 30
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
UID_RE = re.compile(r"^[a-f0-9]{32}$")


# ----------------------------------------------------------------------------
# Identificação do usuário
# ----------------------------------------------------------------------------

def _client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "desconhecido"


@app.before_request
def identify_user():
    uid = request.cookies.get(COOKIE_NAME, "")
    g.new_uid = not UID_RE.match(uid)
    if g.new_uid:
        uid = uuid.uuid4().hex
        # Versões antigas identificavam o usuário pelo IP: migra esses dados.
        try:
            repo.move_user(_client_ip(), uid)
        except Exception:  # noqa: BLE001
            logger.exception("Falha ao migrar dados antigos")
    g.uid = uid


@app.after_request
def set_user_cookie(response):
    if getattr(g, "new_uid", False):
        response.set_cookie(
            COOKIE_NAME, g.uid, max_age=COOKIE_MAX_AGE, httponly=True,
            samesite="Lax", secure=request.is_secure,
        )
    return response


def json_body(view):
    """Exige JSON nas rotas que alteram dados (também protege contra CSRF)."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        if request.method in ("POST", "PATCH", "PUT") and not request.is_json:
            return error("Envie os dados como JSON", 415)
        return view(*args, **kwargs)

    return wrapper


def error(message: str, status: int = 400):
    return jsonify({"success": False, "message": message}), status


def parse_target_price(value) -> float | None:
    if isinstance(value, (int, float)):
        price = float(value)
    else:
        price = scraper.parse_price(str(value or ""))
    if price is None or price <= 0 or price > 10_000_000:
        return None
    return round(price, 2)


def find_product(products: list[dict], product_id: str) -> dict | None:
    return next((p for p in products if p["id"] == product_id), None)


def load_products() -> list[dict]:
    return [monitor.normalize_product(p) for p in repo.get_products(g.uid)]


# ----------------------------------------------------------------------------
# Páginas
# ----------------------------------------------------------------------------

@app.route("/")
def home():
    return render_template("index.html", lojas=scraper.SUPPORTED_STORES)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------

@app.get("/api/estado")
def estado():
    return jsonify({
        "success": True,
        "email": repo.get_email(g.uid),
        "email_configurado": notifier.is_configured(),
        "produtos": load_products(),
        "lojas": scraper.SUPPORTED_STORES,
    })


@app.post("/api/email")
@json_body
def atualizar_email():
    email = (request.get_json().get("email") or "").strip()
    if not EMAIL_RE.match(email) or len(email) > 254:
        return error("Informe um email válido")
    repo.set_email(g.uid, email)
    return jsonify({"success": True, "message": "Email salvo com sucesso!"})


@app.post("/api/email/teste")
def testar_email():
    email = repo.get_email(g.uid)
    if not email:
        return error("Salve um email primeiro")
    if not notifier.is_configured():
        return error("O servidor ainda não tem um remetente de email configurado "
                     "(EMAIL_USER / EMAIL_PASSWORD)", 503)
    if not notifier.send_test_email(email):
        return error("Não foi possível enviar o email de teste", 502)
    return jsonify({"success": True, "message": f"Email de teste enviado para {email}"})


@app.post("/api/produtos")
@json_body
def adicionar_produto():
    data = request.get_json()
    url = (data.get("url") or "").strip()
    nome = (data.get("nome") or "").strip()[:200]
    preco = parse_target_price(data.get("preco_desejado"))

    if not scraper.is_valid_url(url):
        return error("Informe uma URL válida (começando com http:// ou https://)")
    if preco is None:
        return error("Informe um preço desejado válido")

    products = load_products()
    if len(products) >= MAX_PRODUCTS:
        return error(f"Limite de {MAX_PRODUCTS} produtos atingido")
    if any(p["url"] == url for p in products):
        return error("Este produto já está sendo monitorado")

    # Já busca o preço atual (e o nome, se não foi informado).
    result = scraper.fetch_product(url)
    product = monitor.new_product(nome or result.name or url, url, preco)
    resultado = monitor.apply_result(product, result, repo.get_email(g.uid))

    products.append(product)
    repo.save_products(g.uid, products)

    message = "Produto adicionado!"
    if result.price is None:
        message += " (Não consegui ler o preço agora; vou tentar novamente na próxima verificação.)"
    return jsonify({"success": True, "message": message, "produto": product,
                    "resultado": resultado}), 201


@app.patch("/api/produtos/<product_id>")
@json_body
def editar_produto(product_id):
    data = request.get_json()
    products = load_products()
    product = find_product(products, product_id)
    if not product:
        return error("Produto não encontrado", 404)

    if "preco_desejado" in data:
        preco = parse_target_price(data["preco_desejado"])
        if preco is None:
            return error("Informe um preço desejado válido")
        if preco != product["preco_desejado"]:
            product["preco_desejado"] = preco
            product["alertado"] = False
    if "nome" in data:
        nome = (data.get("nome") or "").strip()[:200]
        if not nome:
            return error("O nome não pode ficar vazio")
        product["nome"] = nome

    repo.save_products(g.uid, products)
    return jsonify({"success": True, "message": "Produto atualizado!", "produto": product})


@app.delete("/api/produtos/<product_id>")
def remover_produto(product_id):
    products = load_products()
    remaining = [p for p in products if p["id"] != product_id]
    if len(remaining) == len(products):
        return error("Produto não encontrado", 404)
    repo.save_products(g.uid, remaining)
    return jsonify({"success": True, "message": "Produto removido!"})


@app.post("/api/verificar")
def verificar_todos():
    products = load_products()
    if not products:
        return error("Adicione pelo menos um produto")
    resultados = monitor.check_products(products, repo.get_email(g.uid))
    repo.save_products(g.uid, products)
    return jsonify({"success": True, "resultados": resultados, "produtos": products})


@app.post("/api/produtos/<product_id>/verificar")
def verificar_um(product_id):
    products = load_products()
    product = find_product(products, product_id)
    if not product:
        return error("Produto não encontrado", 404)
    [resultado] = monitor.check_products([product], repo.get_email(g.uid))
    repo.save_products(g.uid, products)
    return jsonify({"success": True, "resultado": resultado, "produto": product})


@app.get("/api/cron")
def cron():
    """Verificação automática de todos os usuários (Vercel Cron / agendador externo)."""
    secret = os.getenv("CRON_SECRET")
    if not secret:
        return error("CRON_SECRET não configurado", 503)
    auth = request.headers.get("Authorization", "")
    if not hmac.compare_digest(auth, f"Bearer {secret}"):
        return error("Não autorizado", 401)

    resumo = {"usuarios": 0, "produtos": 0, "alertas": 0, "erros": 0}
    for uid in repo.all_user_ids():
        products = [monitor.normalize_product(p) for p in repo.get_products(uid)]
        if not products:
            continue
        resultados = monitor.check_products(products, repo.get_email(uid))
        repo.save_products(uid, products)
        resumo["usuarios"] += 1
        resumo["produtos"] += len(resultados)
        resumo["alertas"] += sum(r["status"] == "alerta_enviado" for r in resultados)
        resumo["erros"] += sum(r["status"] == "erro" for r in resultados)
    logger.info("Cron concluído: %s", resumo)
    return jsonify({"success": True, **resumo})


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return error("Rota não encontrada", 404)
    return render_template("index.html", lojas=scraper.SUPPORTED_STORES), 404


@app.errorhandler(Exception)
def unhandled(exc):
    from werkzeug.exceptions import HTTPException

    if isinstance(exc, HTTPException):
        return error(exc.description or exc.name, exc.code or 500)
    logger.exception("Erro inesperado")
    return error("Erro interno no servidor", 500)


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG") == "1", port=int(os.getenv("PORT", "5000")))

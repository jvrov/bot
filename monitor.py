"""Regras de monitoramento compartilhadas entre a interface web e a CLI."""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import ai
import notifier
import scraper
import search

logger = logging.getLogger(__name__)

MAX_HISTORY = 60
MAX_WORKERS = 6


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_product(raw: dict) -> dict:
    """Garante que um produto tenha todos os campos (migra formatos antigos)."""
    product = dict(raw)
    product.setdefault("id", uuid.uuid4().hex[:12])
    if "preco_desejado" not in product and "preco_alvo" in product:
        product["preco_desejado"] = product.pop("preco_alvo")
    product["preco_desejado"] = float(product.get("preco_desejado") or 0)
    product.setdefault("nome", product.get("url", "Produto"))
    product.setdefault("loja", scraper.detect_store(product.get("url", "")))
    product.setdefault("criado_em", now_iso())
    product.setdefault("preco_atual", None)
    product.setdefault("preco_minimo", None)
    product.setdefault("ultima_verificacao", None)
    product.setdefault("historico", [])
    product.setdefault("alertado", False)
    product.setdefault("erro", None)
    product.setdefault("tipo", "link")
    product.setdefault("imagem", None)
    if product["tipo"] == "busca":
        product.setdefault("texto", product["nome"])
        product.setdefault("interpretacao", {})
        product.setdefault("melhor_oferta", None)
        product.setdefault("ofertas", [])
    return product


def new_product(nome: str, url: str, preco_desejado: float, imagem: str | None = None) -> dict:
    return normalize_product(
        {"nome": nome.strip(), "url": url.strip(), "preco_desejado": preco_desejado,
         "imagem": imagem}
    )


def new_search(texto: str, interpretacao: dict, preco_desejado: float) -> dict:
    """Um monitor de busca: avisa quando QUALQUER oferta compatível ficar abaixo do alvo."""
    return normalize_product({
        "tipo": "busca",
        "nome": texto.strip(),
        "texto": texto.strip(),
        "url": "",
        "interpretacao": {k: interpretacao.get(k) for k in
                          ("termo_busca", "categoria", "requisitos", "preco_maximo", "resumo")},
        "preco_desejado": preco_desejado,
    })


def update_search_offers(product: dict, ofertas: list[dict]) -> scraper.ScrapeResult:
    """Guarda as melhores ofertas compatíveis e devolve o melhor preço como resultado."""
    ofertas = sorted(ofertas, key=lambda o: o["preco"])
    product["ofertas"] = ofertas[:8]
    if not ofertas:
        return scraper.ScrapeResult(price=None, error="Nenhuma oferta compatível encontrada agora")
    best = ofertas[0]
    product["melhor_oferta"] = best
    product["url"] = best["url"]
    product["imagem"] = best.get("imagem") or product.get("imagem")
    return scraper.ScrapeResult(price=best["preco"], name=best["titulo"])


def run_search(product: dict) -> scraper.ScrapeResult:
    interp = product.get("interpretacao") or {}
    termo = interp.get("termo_busca") or product["texto"]
    ofertas, erros = search.search_all(termo)
    if not ofertas:
        detalhe = "; ".join(f"{search.SUPPORTED_STORES[k]}: {v}" for k, v in erros.items())
        return scraper.ScrapeResult(price=None, error=f"Nenhuma loja respondeu ({detalhe})")
    compativeis, _ = ai.filter_offers(product["texto"], interp, ofertas)
    return update_search_offers(product, compativeis)


def _fetch(product: dict) -> scraper.ScrapeResult:
    if product.get("tipo") == "busca":
        return run_search(product)
    return scraper.fetch_product(product["url"])


def apply_result(product: dict, result: scraper.ScrapeResult, email: str | None) -> dict:
    """Atualiza o produto com o resultado de uma verificação e envia alerta se preciso.

    Um alerta só é enviado uma vez por "queda": se o preço voltar a subir acima
    do alvo, o próximo recuo dispara um novo email.
    """
    product["ultima_verificacao"] = now_iso()

    if result.price is None:
        product["erro"] = result.error or "Preço não encontrado"
        return {"id": product["id"], "nome": product["nome"], "status": "erro",
                "mensagem": product["erro"]}

    price = round(result.price, 2)
    product["erro"] = None
    product["preco_atual"] = price
    if product["preco_minimo"] is None or price < product["preco_minimo"]:
        product["preco_minimo"] = price

    historico = product["historico"]
    historico.append({"t": product["ultima_verificacao"], "p": price})
    del historico[:-MAX_HISTORY]

    base = {
        "id": product["id"],
        "nome": product["nome"],
        "preco_atual": price,
        "preco_desejado": product["preco_desejado"],
    }

    if price > product["preco_desejado"]:
        product["alertado"] = False
        return {**base, "status": "monitorado"}

    if product["alertado"]:
        return {**base, "status": "abaixo_do_alvo"}

    if email and notifier.send_price_alert(email, product, price):
        product["alertado"] = True
        return {**base, "status": "alerta_enviado"}

    motivo = "Email não configurado" if not email else "Falha ao enviar o email"
    return {**base, "status": "abaixo_do_alvo", "mensagem": motivo}


def check_products(products: list[dict], email: str | None) -> list[dict]:
    """Verifica todos os produtos em paralelo e devolve os resultados."""
    if not products:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(products))) as pool:
        scraped = list(pool.map(_fetch, products))
    return [apply_result(p, r, email) for p, r in zip(products, scraped)]

import json

import pytest

import monitor
import notifier
import scraper
from scraper import ScrapeResult, extract_from_html, parse_price


# --------------------------------------------------------------------------
# parse_price
# --------------------------------------------------------------------------
@pytest.mark.parametrize("text,expected", [
    ("R$ 1.234,56", 1234.56),
    ("R$\xa0899,90", 899.90),
    ("1234.56", 1234.56),
    ("1.299", 1299.0),
    ("1,299.99", 1299.99),
    ("2.499.000", 2499000.0),
    ("  59,9 ", 59.9),
    (1500, 1500.0),
    ("", None),
    ("grátis", None),
    ("0,00", None),
    (None, None),
])
def test_parse_price(text, expected):
    assert parse_price(text) == expected


def test_detect_store():
    assert scraper.detect_store("https://www.kabum.com.br/produto/1") == "kabum"
    assert scraper.detect_store("https://produto.mercadolivre.com.br/MLB-1") == "mercadolivre"
    assert scraper.detect_store("https://www.amazon.com.br/dp/X") == "amazon"
    assert scraper.detect_store("https://www.magazineluiza.com.br/p/1") == "magazineluiza"
    assert scraper.detect_store("https://example.com") is None


def test_is_valid_url():
    assert scraper.is_valid_url("https://a.com/x")
    assert not scraper.is_valid_url("javascript:alert(1)")
    assert not scraper.is_valid_url("kabum.com.br")


# --------------------------------------------------------------------------
# Extração de HTML
# --------------------------------------------------------------------------
def test_extract_kabum_selector():
    html = '<html><head><title>PS5</title></head><body><h4 class="finalPrice">R$ 3.499,90</h4></body></html>'
    r = extract_from_html(html, "https://www.kabum.com.br/produto/1")
    assert r.price == 3499.90
    assert r.name == "PS5"


def test_extract_jsonld_generic_store():
    data = {"@context": "https://schema.org", "@type": "Product", "name": "Mouse Gamer",
            "offers": {"@type": "Offer", "price": "149.90", "priceCurrency": "BRL"}}
    html = f'<html><script type="application/ld+json">{json.dumps(data)}</script></html>'
    r = extract_from_html(html, "https://loja-qualquer.com/mouse")
    assert r.price == 149.90
    assert r.name == "Mouse Gamer"


def test_extract_jsonld_graph_and_offer_list():
    data = {"@graph": [{"@type": "WebPage"}, {"@type": ["Product"], "name": "SSD",
            "offers": [{"price": 400}, {"price": 350.5}]}]}
    html = f'<script type="application/ld+json">{json.dumps(data)}</script>'
    assert extract_from_html(html, "https://x.com").price == 350.5


def test_extract_meta_itemprop():
    html = '<meta itemprop="price" content="1999.00"><meta property="og:title" content="TV 50">'
    r = extract_from_html(html, "https://x.com")
    assert r.price == 1999.0
    assert r.name == "TV 50"


def test_extract_not_found():
    r = extract_from_html("<html><body>nada</body></html>", "https://x.com")
    assert r.price is None and r.error


# --------------------------------------------------------------------------
# Regras de alerta
# --------------------------------------------------------------------------
@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(notifier, "send_price_alert",
                        lambda email, produto, preco: calls.append(preco) or True)
    return calls


def test_alert_sent_only_once_per_drop(sent):
    p = monitor.new_product("TV", "https://x.com/tv", 1000)
    assert monitor.apply_result(p, ScrapeResult(1200), "a@b.com")["status"] == "monitorado"
    assert monitor.apply_result(p, ScrapeResult(950), "a@b.com")["status"] == "alerta_enviado"
    assert monitor.apply_result(p, ScrapeResult(900), "a@b.com")["status"] == "abaixo_do_alvo"
    assert sent == [950]
    # Sobe de novo e volta a cair -> novo alerta
    monitor.apply_result(p, ScrapeResult(1100), "a@b.com")
    assert monitor.apply_result(p, ScrapeResult(990), "a@b.com")["status"] == "alerta_enviado"
    assert sent == [950, 990]
    assert p["preco_minimo"] == 900
    assert len(p["historico"]) == 5


def test_error_keeps_last_price(sent):
    p = monitor.new_product("TV", "https://x.com/tv", 1000)
    monitor.apply_result(p, ScrapeResult(1200), None)
    r = monitor.apply_result(p, ScrapeResult(None, error="bloqueado"), None)
    assert r["status"] == "erro"
    assert p["preco_atual"] == 1200 and p["erro"] == "bloqueado"


def test_normalize_legacy_product():
    p = monitor.normalize_product({"nome": "X", "url": "https://www.kabum.com.br/a", "preco_alvo": 10})
    assert p["preco_desejado"] == 10.0 and "preco_alvo" not in p
    assert p["loja"] == "kabum" and p["id"]


def test_brl():
    assert notifier.brl(1234.5) == "R$ 1.234,50"


# --------------------------------------------------------------------------
# API Flask
# --------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path, monkeypatch, sent):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("DATA_FILE", str(tmp_path / "data.json"))
    import importlib

    import app as app_module
    importlib.reload(app_module)
    monkeypatch.setattr(scraper, "fetch_product",
                        lambda url, session=None: ScrapeResult(price=500.0, name="Produto Teste"))
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def test_full_flow(client):
    r = client.get("/api/estado")
    assert r.status_code == 200 and r.json["produtos"] == []

    assert client.post("/api/email", json={"email": "invalido"}).status_code == 400
    assert client.post("/api/email", json={"email": "a@b.com"}).json["success"]

    r = client.post("/api/produtos", json={"url": "https://www.kabum.com.br/produto/1",
                                           "preco_desejado": "450,00"})
    assert r.status_code == 201
    produto = r.json["produto"]
    assert produto["nome"] == "Produto Teste" and produto["preco_atual"] == 500.0

    # Duplicado
    assert client.post("/api/produtos", json={"url": "https://www.kabum.com.br/produto/1",
                                              "preco_desejado": 1}).status_code == 400

    r = client.patch(f"/api/produtos/{produto['id']}", json={"preco_desejado": 600})
    assert r.json["produto"]["preco_desejado"] == 600

    r = client.post("/api/verificar")
    assert r.json["resultados"][0]["status"] == "alerta_enviado"

    assert client.delete(f"/api/produtos/{produto['id']}").json["success"]
    assert client.get("/api/estado").json["produtos"] == []


def test_rejects_bad_input(client):
    assert client.post("/api/produtos", json={"url": "javascript:alert(1)",
                                              "preco_desejado": 10}).status_code == 400
    assert client.post("/api/produtos", json={"url": "https://x.com",
                                              "preco_desejado": "abc"}).status_code == 400
    # Formulário (não-JSON) é recusado -> proteção CSRF
    assert client.post("/api/email", data={"email": "a@b.com"}).status_code == 415


def test_cron_requires_secret(client, monkeypatch):
    assert client.get("/api/cron").status_code == 503
    monkeypatch.setenv("CRON_SECRET", "s3cr3t")
    assert client.get("/api/cron").status_code == 401
    r = client.get("/api/cron", headers={"Authorization": "Bearer s3cr3t"})
    assert r.status_code == 200 and r.json["success"]


def test_home_renders(client):
    r = client.get("/")
    assert r.status_code == 200 and b"Price Monitor" in r.data


def test_health_reports_config_without_values(client, monkeypatch):
    monkeypatch.setenv("EMAIL_USER", "bot@x.com")
    monkeypatch.setenv("EMAIL_PASSWORD", "segredo")
    r = client.get("/health").json
    assert r["email_configurado"] is True and r["banco"] == "JSONFileStore"
    assert "segredo" not in json.dumps(r)

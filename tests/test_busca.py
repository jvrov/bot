import json

import pytest

import ai
import monitor
import notifier
import search


# --------------------------------------------------------------------------
# Interpretação (modo sem IA)
# --------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def sem_ia(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def test_interpret_heuristic_monitor():
    r = ai.interpret("quero um monitor de 280hz de 25 polegadas até R$ 1.500")
    assert r["ia"] is False
    assert r["preco_maximo"] == 1500
    assert "monitor" in r["termo_busca"] and "280hz" in r["termo_busca"]
    assert "1.500" not in r["termo_busca"] and "1500" not in r["termo_busca"]
    assert r["categoria"] == "monitor"
    assert '25"' in r["requisitos"] and "280 Hz" in r["requisitos"]


@pytest.mark.parametrize("texto,preco", [
    ("ssd 1tb até 400 reais", 400),
    ("notebook no máximo 3 mil", 3000),
    ("fone bluetooth abaixo de R$ 299,90", 299.90),
    ("placa de vídeo rtx 4060", None),
])
def test_extract_price(texto, preco):
    assert ai.extract_price(texto) == preco


def test_filter_heuristic_tolerates_24_5_inches_and_rejects_accessories():
    interp = ai.interpret_heuristic("monitor 280hz 25 polegadas")
    ofertas = [
        {"titulo": 'Monitor Gamer AOC 24,5" 280Hz IPS 1ms', "preco": 1199.0},
        {"titulo": "Monitor Gamer 27 polegadas 280Hz", "preco": 1500.0},
        {"titulo": 'Monitor 24.5" 180Hz', "preco": 900.0},
        {"titulo": 'Suporte articulado para monitor 25" 280hz', "preco": 99.0},
        {"titulo": 'Monitor LG UltraGear 25 pol 280 Hz', "preco": 1300.0},
    ]
    out = ai.filter_heuristic("monitor 280hz 25 polegadas", interp, ofertas)
    titulos = [o["titulo"] for o in out]
    assert titulos == ['Monitor Gamer AOC 24,5" 280Hz IPS 1ms', "Monitor LG UltraGear 25 pol 280 Hz"]
    assert all(o["motivo"] for o in out)


def test_filter_offers_sorts_by_price():
    interp = ai.interpret_heuristic("ssd 1tb")
    ofertas = [{"titulo": "SSD Kingston 1TB NVMe", "preco": 450.0},
               {"titulo": "SSD WD 1TB SATA", "preco": 380.0}]
    out, usou_ia = ai.filter_offers("ssd 1tb", interp, ofertas)
    assert not usou_ia and [o["preco"] for o in out] == [380.0, 450.0]


# --------------------------------------------------------------------------
# Leitores das páginas de busca (HTML sintético)
# --------------------------------------------------------------------------
def next_data(obj):
    return f'<script id="__NEXT_DATA__" type="application/json">{json.dumps(obj)}</script>'


def test_parse_kabum_next_data_with_nested_json_string():
    catalog = {"catalogServer": {"data": [
        {"code": 123, "name": "Monitor Gamer 24.5 280Hz", "price": 1399.9,
         "priceWithDiscount": 1189.9, "friendlyName": "monitor-gamer-24-5-280hz",
         "image": "https://img.kabum.com.br/1.jpg"},
        {"code": 456, "name": "Monitor 2", "priceWithDiscount": 999, "friendlyName": "monitor-2"},
    ]}}
    html = next_data({"props": {"pageProps": {"data": json.dumps(catalog)}}})
    out = search.parse_kabum(html)
    assert out[0] == {"titulo": "Monitor Gamer 24.5 280Hz", "preco": 1189.9,
                      "url": "https://www.kabum.com.br/produto/123/monitor-gamer-24-5-280hz",
                      "loja": "kabum", "imagem": "https://img.kabum.com.br/1.jpg"}
    assert len(out) == 2


def test_parse_mercadolivre_poly_cards():
    html = """
    <ol><li class="ui-search-layout__item"><div class="poly-card">
      <img data-src="https://http2.mlstatic.com/a.webp" src="data:image/gif;base64,xx">
      <h3><a class="poly-component__title" href="https://produto.mercadolivre.com.br/MLB-1#pos">Monitor 280Hz 24,5</a></h3>
      <div class="poly-price__current"><span class="andes-money-amount__fraction">1.249</span>
      <span class="andes-money-amount__cents">90</span></div>
    </div></li></ol>"""
    out = search.parse_mercadolivre(html)
    assert out == [{"titulo": "Monitor 280Hz 24,5", "preco": 1249.9,
                    "url": "https://produto.mercadolivre.com.br/MLB-1", "loja": "mercadolivre",
                    "imagem": "https://http2.mlstatic.com/a.webp"}]


def test_parse_amazon_results():
    html = """
    <div data-component-type="s-search-result" data-asin="B0TEST">
      <img class="s-image" src="https://m.media-amazon.com/x.jpg">
      <h2 aria-label="Monitor Gamer 25 280Hz"><span>Monitor Gamer 25 280Hz</span></h2>
      <span class="a-price"><span class="a-offscreen">R$ 1.099,00</span></span>
      <span class="a-price a-text-price"><span class="a-offscreen">R$ 1.599,00</span></span>
    </div>"""
    out = search.parse_amazon(html)
    assert out[0]["preco"] == 1099.0 and out[0]["url"] == "https://www.amazon.com.br/dp/B0TEST"


def test_parse_magalu_next_data():
    html = next_data({"props": {"pageProps": {"data": {"search": {"products": [
        {"title": "Monitor Gamer 25", "url": "monitor-gamer/p/abc123/in/mgam/",
         "price": {"fullPrice": "1500.00", "bestPrice": "1299.00"},
         "image": "https://a-static.mlcdn.com.br/{w}x{h}/x.jpg"}]}}}}})
    out = search.parse_magalu(html)
    assert out[0]["preco"] == 1299.0
    assert out[0]["url"] == "https://www.magazineluiza.com.br/monitor-gamer/p/abc123/in/mgam/"
    assert out[0]["imagem"] == "https://a-static.mlcdn.com.br/300x300/x.jpg"


def test_parse_jsonld_fallback():
    data = {"@type": "ItemList", "itemListElement": [{"item": {
        "@type": "Product", "name": "SSD 1TB", "url": "/produto/9/ssd",
        "offers": {"price": "399.90"}}}]}
    html = f'<script type="application/ld+json">{json.dumps(data)}</script>'
    out = search.parse_kabum(html)
    assert out[0]["url"] == "https://www.kabum.com.br/produto/9/ssd" and out[0]["preco"] == 399.9


def test_search_all_collects_errors(monkeypatch):
    def fake(loja, termo):
        if loja == "amazon":
            raise search.SearchError("a loja respondeu HTTP 503")
        return [{"titulo": f"x {loja}", "preco": 10.0, "url": f"https://{loja}/1", "loja": loja, "imagem": None}]
    monkeypatch.setattr(search, "search_store", fake)
    ofertas, erros = search.search_all("x")
    assert len(ofertas) == 3 and erros == {"amazon": "a loja respondeu HTTP 503"}


# --------------------------------------------------------------------------
# Monitor de busca
# --------------------------------------------------------------------------
def test_search_monitor_alerts_on_best_compatible_offer(monkeypatch):
    sent = []
    monkeypatch.setattr(notifier, "send_price_alert", lambda e, p, preco: sent.append((p["url"], preco)) or True)
    monkeypatch.setattr(search, "search_all", lambda termo: ([
        {"titulo": 'Monitor 24,5" 280Hz', "preco": 1100.0, "url": "https://a/1", "loja": "kabum", "imagem": None},
        {"titulo": 'Monitor 24,5" 280Hz Pro', "preco": 990.0, "url": "https://a/2", "loja": "amazon", "imagem": None},
        {"titulo": "Suporte monitor 280hz 25 polegadas", "preco": 50.0, "url": "https://a/3", "loja": "amazon", "imagem": None},
    ], {}))
    texto = "monitor 280hz 25 polegadas"
    p = monitor.new_search(texto, ai.interpret_heuristic(texto), 1000)
    [r] = monitor.check_products([p], "a@b.com")
    assert r["status"] == "alerta_enviado" and r["preco_atual"] == 990.0
    assert sent == [("https://a/2", 990.0)]
    assert p["melhor_oferta"]["url"] == "https://a/2" and len(p["ofertas"]) == 2
    assert "Oferta encontrada" in notifier.build_alert("a@b.com", p, 990.0).get_body("plain").get_content()


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("DATA_FILE", str(tmp_path / "data.json"))
    monkeypatch.setattr(notifier, "send_price_alert", lambda *a: True)
    import importlib

    import app as app_module
    importlib.reload(app_module)
    return app_module.app.test_client()


def test_api_search_flow(client, monkeypatch):
    r = client.post("/api/interpretar", json={"texto": "monitor 280hz 25 polegadas até 1500"})
    interp = r.json["interpretacao"]
    assert interp["preco_maximo"] == 1500

    monkeypatch.setattr(search, "search_store", lambda loja, termo: [
        {"titulo": f'Monitor 24,5" 280Hz {loja}', "preco": 1000.0 + len(loja), "url": f"https://{loja}.com/p",
         "loja": loja, "imagem": None}])
    r = client.post("/api/buscar", json={"termo": interp["termo_busca"], "loja": "kabum"})
    assert r.json["ofertas"][0]["loja"] == "kabum"
    assert client.post("/api/buscar", json={"termo": "x", "loja": "ebay"}).status_code == 400

    ofertas = [{"titulo": 'Monitor 24,5" 280Hz', "preco": 1200, "url": "https://x.com/1", "loja": "kabum"},
               {"titulo": "Mouse gamer", "preco": 100, "url": "https://x.com/2", "loja": "kabum"},
               {"titulo": "lixo", "preco": 1, "url": "javascript:alert(1)", "loja": "kabum"}]
    r = client.post("/api/filtrar", json={"texto": "monitor 280hz 25 polegadas", "interpretacao": interp,
                                          "ofertas": ofertas})
    assert r.json["total"] == 2 and [o["titulo"] for o in r.json["ofertas"]] == ['Monitor 24,5" 280Hz']

    r = client.post("/api/produtos", json={"tipo": "busca", "texto": "monitor 280hz 25 polegadas",
                                           "interpretacao": interp, "ofertas": r.json["ofertas"],
                                           "preco_desejado": 1100})
    assert r.status_code == 201
    p = r.json["produto"]
    assert p["tipo"] == "busca" and p["preco_atual"] == 1200 and p["melhor_oferta"]["url"] == "https://x.com/1"


def test_api_add_from_search_result_uses_known_price(client, monkeypatch):
    import scraper
    monkeypatch.setattr(scraper, "fetch_product", lambda *a, **k: pytest.fail("não deveria baixar a página"))
    r = client.post("/api/produtos", json={"url": "https://www.kabum.com.br/produto/1/x", "nome": "Monitor X",
                                           "imagem": "https://img/x.jpg", "preco_atual": 999.9,
                                           "preco_desejado": 900})
    p = r.json["produto"]
    assert p["preco_atual"] == 999.9 and p["imagem"] == "https://img/x.jpg" and p["tipo"] == "link"


def test_filter_heuristic_requires_model_numbers():
    interp = ai.interpret_heuristic("placa de vídeo RTX 4060")
    ofertas = [{"titulo": "Placa de Vídeo RTX 4060 8GB", "preco": 1900.0},
               {"titulo": "Placa de Vídeo RTX 3060 12GB", "preco": 1500.0}]
    out = ai.filter_heuristic("placa de vídeo RTX 4060", interp, ofertas)
    assert [o["titulo"] for o in out] == ["Placa de Vídeo RTX 4060 8GB"]

"""Busca de produtos nas lojas a partir de um termo (ex.: "monitor 280hz 25 polegadas")."""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, quote_plus, urljoin

import requests
from bs4 import BeautifulSoup

from scraper import HEADERS, SUPPORTED_STORES, parse_price

logger = logging.getLogger(__name__)

TIMEOUT = 12
MAX_PER_STORE = 20

STORE_BASE = {
    "kabum": "https://www.kabum.com.br",
    "mercadolivre": "https://www.mercadolivre.com.br",
    "amazon": "https://www.amazon.com.br",
    "magazineluiza": "https://www.magazineluiza.com.br",
}


class SearchError(Exception):
    pass


def slugify(term: str) -> str:
    return re.sub(r"[^\w]+", "-", term.lower(), flags=re.UNICODE).strip("-")


def offer(titulo, preco, url, loja, imagem=None) -> dict | None:
    titulo = (titulo or "").strip()
    preco = parse_price(preco)
    if not titulo or not preco or not url:
        return None
    return {"titulo": re.sub(r"\s+", " ", titulo)[:220], "preco": round(preco, 2),
            "url": url, "loja": loja, "imagem": imagem or None}


def _dedupe(offers: list[dict | None]) -> list[dict]:
    seen, out = set(), []
    for o in offers:
        if o and o["url"] not in seen:
            seen.add(o["url"])
            out.append(o)
    return out[:MAX_PER_STORE]


def _get(url: str) -> str:
    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise SearchError("a loja não respondeu") from exc
    if r.status_code >= 400:
        raise SearchError(f"a loja respondeu HTTP {r.status_code}")
    return r.text


# ---------------------------------------------------------------------------
# Extração genérica de JSON embutido (Next.js, JSON-LD)
# ---------------------------------------------------------------------------

def _walk(obj, depth=0):
    """Percorre um JSON (decodificando strings que contenham JSON)."""
    if depth > 40:
        return
    if isinstance(obj, str):
        s = obj.strip()
        if len(s) > 50 and s[:1] in "{[":
            try:
                yield from _walk(json.loads(s), depth + 1)
            except json.JSONDecodeError:
                pass
        return
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, depth + 1)


def _first(d: dict, *keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", [], {}):
            return v
    return None


def _price_of(d: dict):
    v = _first(d, "priceWithDiscount", "bestPrice", "salePrice", "price", "lowPrice", "value")
    if isinstance(v, dict):
        return _price_of(v)
    if isinstance(v, list):
        return None
    return v


def _image_of(d: dict):
    v = _first(d, "image", "imageUrl", "thumbnail", "thumbnailUrl", "img", "picture")
    if isinstance(v, list):
        v = v[0] if v else None
    if isinstance(v, dict):
        v = _first(v, "url", "src", "contentUrl")
    if isinstance(v, str):
        return v.replace("{w}x{h}", "300x300")
    return None


def _next_data(html: str):
    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag or not tag.string:
        return None
    try:
        return json.loads(tag.string)
    except json.JSONDecodeError:
        return None


def _jsonld_offers(html: str, loja: str, base: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for d in _walk(data):
            if d.get("@type") == "Product" or "Product" in (d.get("@type") or []):
                offers = d.get("offers") or {}
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}
                url = d.get("url") or (offers.get("url") if isinstance(offers, dict) else None)
                if url:
                    out.append(offer(d.get("name"), _price_of(offers) if isinstance(offers, dict) else None,
                                     urljoin(base, url), loja, _image_of(d)))
    return _dedupe(out)


def harvest_json(data, loja: str, url_builder) -> list[dict]:
    """Procura objetos com cara de produto (nome + preço + link) em qualquer JSON."""
    out = []
    for d in _walk(data):
        titulo = _first(d, "name", "title", "productName")
        if not isinstance(titulo, str):
            continue
        preco = _price_of(d)
        if preco is None or isinstance(preco, bool):
            continue
        url = url_builder(d)
        if url:
            out.append(offer(titulo, preco, url, loja, _image_of(d)))
    return _dedupe(out)


# ---------------------------------------------------------------------------
# Lojas
# ---------------------------------------------------------------------------

def parse_kabum(html: str) -> list[dict]:
    base = STORE_BASE["kabum"]

    def build(d):
        code = d.get("code") or d.get("id")
        friendly = d.get("friendlyName") or d.get("slug")
        if code and friendly and str(code).isdigit():
            return f"{base}/produto/{code}/{friendly}"
        link = d.get("link") or d.get("url")
        return urljoin(base, link) if isinstance(link, str) and "/produto/" in link else None

    data = _next_data(html)
    found = harvest_json(data, "kabum", build) if data else []
    return found or _jsonld_offers(html, "kabum", base)


def parse_mercadolivre(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    cards = soup.select("li.ui-search-layout__item, div.poly-card, div.ui-search-result__wrapper")
    for card in cards:
        link = card.select_one("a.poly-component__title, h3 a, h2 a, a.ui-search-link")
        if not link or not link.get("href"):
            continue
        price_box = card.select_one(".poly-price__current, .ui-search-price__second-line") or card
        frac = price_box.select_one(".andes-money-amount__fraction")
        cents = price_box.select_one(".andes-money-amount__cents")
        if not frac:
            continue
        price = frac.get_text(strip=True).replace(".", "")
        if cents:
            price += "," + cents.get_text(strip=True)
        img = card.select_one("img")
        image = img and (img.get("data-src") or img.get("src"))
        if image and image.startswith("data:"):
            image = None
        url = link["href"].split("#")[0]
        out.append(offer(link.get_text(" ", strip=True), price, url, "mercadolivre", image))
    return _dedupe(out) or _jsonld_offers(html, "mercadolivre", STORE_BASE["mercadolivre"])


def parse_amazon(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    base = STORE_BASE["amazon"]
    out = []
    for card in soup.select('div[data-component-type="s-search-result"]'):
        asin = card.get("data-asin")
        h2 = card.select_one("h2")
        title = h2 and (h2.get("aria-label") or h2.get_text(" ", strip=True))
        price = card.select_one("span.a-price:not(.a-text-price) span.a-offscreen")
        img = card.select_one("img.s-image")
        if not (asin and title and price):
            continue
        out.append(offer(title, price.get_text(strip=True), f"{base}/dp/{asin}", "amazon",
                         img.get("src") if img else None))
    return _dedupe(out)


def parse_magalu(html: str) -> list[dict]:
    base = STORE_BASE["magazineluiza"]

    def build(d):
        path = _first(d, "url", "path", "link")
        if isinstance(path, str) and ("/p/" in path or path.startswith("p/")):
            return urljoin(base + "/", path.lstrip("/"))
        return None

    data = _next_data(html)
    found = harvest_json(data, "magazineluiza", build) if data else []
    return found or _jsonld_offers(html, "magazineluiza", base)


STORES = {
    "kabum": (lambda t: f"{STORE_BASE['kabum']}/busca/{quote(slugify(t))}", parse_kabum),
    "mercadolivre": (lambda t: f"https://lista.mercadolivre.com.br/{quote(slugify(t))}", parse_mercadolivre),
    "amazon": (lambda t: f"{STORE_BASE['amazon']}/s?k={quote_plus(t)}", parse_amazon),
    "magazineluiza": (lambda t: f"{STORE_BASE['magazineluiza']}/busca/{quote(t)}/", parse_magalu),
}

assert set(STORES) <= set(SUPPORTED_STORES)


def search_store(loja: str, termo: str) -> list[dict]:
    if loja not in STORES:
        raise SearchError("loja não suportada")
    build_url, parse = STORES[loja]
    html = _get(build_url(termo))
    try:
        return parse(html)
    except Exception as exc:  # noqa: BLE001 - layout inesperado
        logger.exception("Falha ao ler resultados de %s", loja)
        raise SearchError("não consegui ler a página de resultados") from exc


def search_all(termo: str) -> tuple[list[dict], dict[str, str]]:
    """Busca em todas as lojas em paralelo. Retorna (ofertas, erros_por_loja)."""
    ofertas, erros = [], {}

    def run(loja):
        try:
            return loja, search_store(loja, termo), None
        except SearchError as exc:
            return loja, [], str(exc)

    with ThreadPoolExecutor(max_workers=len(STORES)) as pool:
        for loja, found, err in pool.map(run, STORES):
            ofertas.extend(found)
            if err:
                erros[loja] = err
    return ofertas, erros

"""Extração de preços e nomes de produtos a partir de páginas de lojas online."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

TIMEOUT = 15

# Seletores específicos por loja (testados em ordem; o primeiro que achar vence).
STORE_SELECTORS: dict[str, list[str]] = {
    "amazon": [
        "#corePriceDisplay_desktop_feature_div .a-offscreen",
        "#corePrice_feature_div .a-offscreen",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        "span.a-price span.a-offscreen",
    ],
    "mercadolivre": [
        ".ui-pdp-price__second-line .andes-money-amount",
        "meta[itemprop=price]",
        ".andes-money-amount",
    ],
    "kabum": [
        "h4.finalPrice",
        "[class*=finalPrice]",
    ],
    "magazineluiza": [
        "[data-testid=price-value]",
        "p.price-template__text",
    ],
}

SUPPORTED_STORES = {
    "amazon": "Amazon",
    "mercadolivre": "Mercado Livre",
    "kabum": "KaBuM!",
    "magazineluiza": "Magazine Luiza",
}


@dataclass
class ScrapeResult:
    price: float | None
    name: str | None = None
    error: str | None = None


def detect_store(url: str) -> str | None:
    """Retorna a chave da loja suportada para a URL, ou None."""
    host = (urlparse(url).hostname or "").lower()
    if "amazon." in host:
        return "amazon"
    if "mercadolivre" in host or "mercadolibre" in host:
        return "mercadolivre"
    if "kabum" in host:
        return "kabum"
    if "magazineluiza" in host or "magalu" in host:
        return "magazineluiza"
    return None


def is_valid_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def parse_price(text: str | float | int | None) -> float | None:
    """Converte textos como 'R$ 1.234,56', '1234.56' ou '1.299' em float.

    Trata tanto o formato brasileiro (ponto como milhar, vírgula decimal)
    quanto o formato internacional (vírgula como milhar, ponto decimal).
    """
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text) if text > 0 else None

    cleaned = re.sub(r"[^\d.,]", "", str(text))
    if not cleaned or not re.search(r"\d", cleaned):
        return None

    has_dot, has_comma = "." in cleaned, "," in cleaned
    if has_dot and has_comma:
        # O separador que aparece por último é o decimal.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif has_comma:
        parts = cleaned.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif has_dot:
        parts = cleaned.split(".")
        # "1.299" ou "1.299.000" -> separador de milhar; "1299.9" -> decimal
        if len(parts) > 2 or len(parts[-1]) == 3:
            cleaned = cleaned.replace(".", "")

    try:
        value = float(cleaned)
    except ValueError:
        return None
    return value if value > 0 else None


def _iter_jsonld(soup: BeautifulSoup):
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                yield item
                if "@graph" in item:
                    stack.append(item["@graph"])


def _price_from_offers(offers) -> float | None:
    if isinstance(offers, list):
        prices = [p for p in (_price_from_offers(o) for o in offers) if p]
        return min(prices) if prices else None
    if isinstance(offers, dict):
        for key in ("price", "lowPrice"):
            price = parse_price(offers.get(key))
            if price:
                return price
        spec = offers.get("priceSpecification")
        if spec:
            return _price_from_offers(spec)
    return None


def _extract_from_jsonld(soup: BeautifulSoup) -> tuple[float | None, str | None]:
    for item in _iter_jsonld(soup):
        types = item.get("@type")
        types = types if isinstance(types, list) else [types]
        if "Product" in types:
            price = _price_from_offers(item.get("offers"))
            name = item.get("name")
            if price:
                return price, name if isinstance(name, str) else None
    return None, None


def _text_of(element) -> str:
    if element.name == "meta":
        return element.get("content", "")
    return element.get("content") or element.get_text(" ", strip=True)


def extract_from_html(html: str, url: str = "") -> ScrapeResult:
    """Extrai preço e nome de um HTML já baixado (útil para testes)."""
    soup = BeautifulSoup(html, "lxml")

    name = None
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        name = og_title["content"].strip()
    elif soup.title and soup.title.string:
        name = soup.title.string.strip()

    # 1) Seletores específicos da loja
    store = detect_store(url)
    for selector in STORE_SELECTORS.get(store or "", []):
        for element in soup.select(selector):
            price = parse_price(_text_of(element))
            if price:
                return ScrapeResult(price=price, name=name)

    # 2) Dados estruturados (JSON-LD) – funciona na maioria das lojas
    price, ld_name = _extract_from_jsonld(soup)
    if price:
        return ScrapeResult(price=price, name=ld_name or name)

    # 3) Meta tags genéricas
    for attrs in (
        {"itemprop": "price"},
        {"property": "product:price:amount"},
        {"property": "og:price:amount"},
    ):
        meta = soup.find(attrs=attrs)
        if meta:
            price = parse_price(_text_of(meta))
            if price:
                return ScrapeResult(price=price, name=name)

    return ScrapeResult(price=None, name=name, error="Preço não encontrado na página")


def fetch_product(url: str, session: requests.Session | None = None) -> ScrapeResult:
    """Baixa a página do produto e extrai preço e nome."""
    if not is_valid_url(url):
        return ScrapeResult(price=None, error="URL inválida")
    http = session or requests
    try:
        response = http.get(url, headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as exc:
        logger.warning("Falha ao acessar %s: %s", url, exc)
        return ScrapeResult(price=None, error="Não foi possível acessar a página")

    if response.status_code >= 400:
        return ScrapeResult(
            price=None,
            error=f"A loja respondeu com erro HTTP {response.status_code}",
        )

    result = extract_from_html(response.text, url)
    if result.price is None:
        logger.info("Preço não encontrado para %s", url)
    return result

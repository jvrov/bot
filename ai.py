"""Entende pedidos em linguagem natural e filtra ofertas compatíveis.

Usa o Claude quando ``ANTHROPIC_API_KEY`` está configurada; senão, cai em
regras simples (regex), que funcionam razoavelmente para pedidos objetivos.
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata

logger = logging.getLogger(__name__)

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5")
MAX_OFFERS_TO_FILTER = 60

_client = None


def ai_enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _get_client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(timeout=float(os.getenv("ANTHROPIC_TIMEOUT", "25")),
                                      max_retries=1)
    return _client


def _ask_json(system: str, user: str, schema: dict, max_tokens: int = 4000) -> dict | None:
    """Chama o Claude pedindo uma resposta JSON validada pelo schema."""
    import anthropic

    try:
        response = _get_client().beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APIStatusError as exc:
        logger.error("Erro da API do Claude (%s): %s", exc.status_code, exc.message)
        return None
    except anthropic.APIConnectionError as exc:
        logger.error("Sem conexão com a API do Claude: %s", exc)
        return None

    if response.stop_reason in ("refusal", "max_tokens"):
        logger.warning("Claude não completou a resposta: %s", response.stop_reason)
        return None
    text = next((b.text for b in response.content if b.type == "text"), None)
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        logger.error("Resposta do Claude não é JSON válido")
        return None


# ---------------------------------------------------------------------------
# Utilidades de texto
# ---------------------------------------------------------------------------

def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.replace("”", '"').replace("“", '"').replace("''", '"')


STOPWORDS = set("""quero queria gostaria preciso procuro procurando busco buscando me um uma uns umas
de do da dos das que com para pra por o a os as e ou em no na nos nas seja sendo tenha
ter tem bom boa barato barata melhor mais menos ate até maximo máximo abaixo pagar
custando custe valor preco preço reais r$ algum alguma comprar compra""".split())

PRICE_RE = re.compile(
    r"(?:at[eé]|no\s+m[aá]ximo|m[aá]ximo(?:\s+de)?|abaixo\s+de|menos\s+de|por\s+at[eé]|"
    r"pagar|custando|or[cç]amento\s+de|r\$)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(mil|k)?",
    re.IGNORECASE,
)

UNIT_ALIASES = {
    "hz": "hz", "polegadas": "pol", "polegada": "pol", "pol": "pol", '"': "pol",
    "gb": "gb", "tb": "tb", "mah": "mah", "w": "w", "mp": "mp", "ms": "ms",
}
SPEC_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(hz|polegadas|polegada|pol|\"|gb|tb|mah|ms|mp|w)(?![a-z])")


def extract_price(text: str) -> float | None:
    m = PRICE_RE.search(text)
    if not m:
        return None
    raw, mult = m.group(1), m.group(2)
    from scraper import parse_price

    value = parse_price(raw)
    if value and mult:
        value *= 1000
    return value


def extract_specs(text: str) -> list[tuple[float, str]]:
    specs = []
    for num, unit in SPEC_RE.findall(_norm(text)):
        specs.append((float(num.replace(",", ".")), UNIT_ALIASES[unit]))
    return specs


def _spec_label(value: float, unit: str) -> str:
    n = f"{value:g}"
    return {"pol": f'{n}"', "hz": f"{n} Hz", "gb": f"{n} GB", "tb": f"{n} TB",
            "mah": f"{n} mAh", "ms": f"{n} ms", "mp": f"{n} MP", "w": f"{n} W"}[unit]


# ---------------------------------------------------------------------------
# 1) Interpretar o pedido
# ---------------------------------------------------------------------------

INTERPRET_SCHEMA = {
    "type": "object",
    "properties": {
        "termo_busca": {"type": "string"},
        "categoria": {"type": "string"},
        "requisitos": {"type": "array", "items": {"type": "string"}},
        "preco_maximo": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "resumo": {"type": "string"},
    },
    "required": ["termo_busca", "categoria", "requisitos", "preco_maximo", "resumo"],
    "additionalProperties": False,
}

INTERPRET_SYSTEM = """Você ajuda brasileiros a encontrar produtos em lojas online (KaBuM!, Mercado Livre, Amazon, Magazine Luiza).
Receba o pedido do usuário e devolva:
- termo_busca: o texto curto (2 a 6 palavras) que funciona melhor na caixa de busca das lojas, incluindo as especificações principais. Ex.: "monitor 280hz 25 polegadas".
- categoria: o tipo de produto, uma ou duas palavras (ex.: "monitor").
- requisitos: lista curta de exigências objetivas que o produto precisa cumprir, em português (ex.: ["taxa de atualização de 280 Hz", "tela de 25 polegadas (24,5\\" também serve)"]). Não invente exigências que o usuário não pediu.
- preco_maximo: o valor máximo em reais se o usuário disser um, senão null.
- resumo: uma frase curta e amigável dizendo o que você vai procurar."""


def interpret_heuristic(texto: str) -> dict:
    preco = extract_price(texto)
    sem_preco = PRICE_RE.sub(" ", texto)
    specs = extract_specs(sem_preco)
    norm = _norm(sem_preco)
    # Junta "280 hz" -> "280hz" para a busca ficar mais precisa
    norm = re.sub(r"(\d)\s+(hz|gb|tb)\b", r"\1\2", norm)
    palavras = [w for w in re.findall(r"[\w\"]+", norm) if w not in STOPWORDS]
    termo = " ".join(palavras[:8]).replace('"', " polegadas").strip() or texto.strip()
    categoria = next((w for w in palavras if not re.search(r"\d", w)), termo.split()[0] if termo else "")
    requisitos = [_spec_label(v, u) for v, u in specs]
    resumo = f"Procurando {termo}" + (f" por até R$ {preco:,.0f}".replace(",", ".") if preco else "")
    return {"termo_busca": termo, "categoria": categoria, "requisitos": requisitos,
            "preco_maximo": preco, "resumo": resumo, "ia": False}


def interpret(texto: str) -> dict:
    texto = texto.strip()[:500]
    if ai_enabled():
        data = _ask_json(INTERPRET_SYSTEM, texto, INTERPRET_SCHEMA, max_tokens=2000)
        if data and data.get("termo_busca"):
            data["ia"] = True
            if data.get("preco_maximo") is not None and data["preco_maximo"] <= 0:
                data["preco_maximo"] = None
            return data
    return interpret_heuristic(texto)


# ---------------------------------------------------------------------------
# 2) Filtrar ofertas compatíveis
# ---------------------------------------------------------------------------

FILTER_SCHEMA = {
    "type": "object",
    "properties": {
        "compativeis": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"indice": {"type": "integer"}, "motivo": {"type": "string"}},
                "required": ["indice", "motivo"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["compativeis"],
    "additionalProperties": False,
}

FILTER_SYSTEM = """Você confere se anúncios de lojas online atendem ao pedido de um comprador.
Considere compatível só o produto principal pedido (não acessórios, peças, capas, suportes ou kits sem o produto) que cumpra os requisitos.
Seja tolerante com variações comuns de nomenclatura (ex.: 24,5" serve para quem pediu 25 polegadas; "280Hz" = "280 Hz").
Ignore o preço: ele é avaliado depois.
Para cada anúncio compatível devolva o índice e um motivo curtíssimo (até 8 palavras) destacando o que bate, ex.: "280 Hz, 24,5\\", IPS"."""


def _matches_heuristic(titulo: str, interpretacao: dict, specs: list[tuple[float, str]]) -> str | None:
    t = _norm(titulo)
    t_specs = extract_specs(titulo)
    categoria = _norm(interpretacao.get("categoria") or "").split()
    if categoria and categoria[0] and categoria[0][:5] not in t:
        return None
    if re.search(r"\b(suporte|capa|pelicula|cabo|adaptador|case)\b", t) and not any(
            w in (categoria or [""])[0] for w in ("suporte", "capa", "pelicula", "cabo", "adaptador", "case")):
        return None
    motivos = []
    # Modelos com número que não são medidas (ex.: "4060" em "rtx 4060") precisam aparecer.
    termo_sem_specs = SPEC_RE.sub(" ", _norm(interpretacao.get("termo_busca") or ""))
    for codigo in re.findall(r"\b(?=\w*\d)\w+\b", termo_sem_specs):
        if codigo not in t.replace(" ", "") and codigo not in t:
            return None
    for valor, unidade in specs:
        tol = 0.6 if unidade == "pol" else 0.001
        if not any(u == unidade and abs(v - valor) <= tol for v, u in t_specs):
            return None
        motivos.append(_spec_label(valor, unidade))
    return ", ".join(motivos) or "Corresponde à busca"


def filter_heuristic(texto: str, interpretacao: dict, ofertas: list[dict]) -> list[dict]:
    specs = extract_specs(texto)
    out = []
    for o in ofertas:
        motivo = _matches_heuristic(o["titulo"], interpretacao, specs)
        if motivo:
            out.append({**o, "motivo": motivo})
    return out


def filter_offers(texto: str, interpretacao: dict, ofertas: list[dict]) -> tuple[list[dict], bool]:
    """Devolve (ofertas compatíveis ordenadas por preço, usou_ia)."""
    ofertas = sorted(ofertas, key=lambda o: o["preco"])[:MAX_OFFERS_TO_FILTER]
    if not ofertas:
        return [], False

    if ai_enabled():
        lista = "\n".join(f"{i}. {o['titulo']}" for i, o in enumerate(ofertas))
        req = "; ".join(interpretacao.get("requisitos") or []) or "(nenhum além do tipo de produto)"
        user = (f"Pedido do comprador: {texto}\nProduto: {interpretacao.get('categoria')}\n"
                f"Requisitos: {req}\n\nAnúncios:\n{lista}")
        data = _ask_json(FILTER_SYSTEM, user, FILTER_SCHEMA, max_tokens=6000)
        if data is not None:
            out, vistos = [], set()
            for item in data.get("compativeis", []):
                i = item.get("indice")
                if isinstance(i, int) and 0 <= i < len(ofertas) and i not in vistos:
                    vistos.add(i)
                    out.append({**ofertas[i], "motivo": (item.get("motivo") or "")[:80]})
            return sorted(out, key=lambda o: o["preco"]), True

    return filter_heuristic(texto, interpretacao, ofertas), False

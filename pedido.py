"""Entende pedidos em linguagem natural e filtra os anúncios compatíveis.

100% gratuito: usa apenas regras próprias (sem nenhuma API paga).

Exemplo:
    "quero um monitor de 280hz de 25 polegadas até R$ 1.500"
    -> termo "monitor 280hz 25 polegadas", categoria "monitor",
       medidas 280 Hz e 25", preço máximo 1500
"""

from __future__ import annotations

import re
import statistics
import unicodedata

from scraper import parse_price


def norm(text: str) -> str:
    """Minúsculas, sem acentos e com aspas padronizadas."""
    text = unicodedata.normalize("NFKD", (text or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.replace("”", '"').replace("“", '"').replace("''", '"').replace("´´", '"')


# ---------------------------------------------------------------------------
# Vocabulário
# ---------------------------------------------------------------------------

STOPWORDS = set("""quero queria gostaria preciso procuro procurando busco buscando me um uma uns umas
de do da dos das que com para pra por o a os as e ou em no na nos nas seja sendo tenha
ter tem bom boa barato barata melhor mais menos ate maximo abaixo pagar ai
custando custe valor preco reais r algum alguma comprar compra novo nova""".split())

# Categorias: nome -> palavras que podem aparecer no título do anúncio
CATEGORIAS = {
    "placa de video": ["placa de video", "placa video", "gpu", "geforce", "radeon"],
    "placa mae": ["placa mae", "placa-mae", "motherboard"],
    "fonte": ["fonte"],
    "processador": ["processador", "cpu", "ryzen", "core i"],
    "memoria ram": ["memoria", "ram", "ddr4", "ddr5"],
    "monitor": ["monitor"],
    "notebook": ["notebook", "laptop"],
    "celular": ["celular", "smartphone", "iphone", "galaxy"],
    "smart tv": ["smart tv", "tv", "televisao", "televisor"],
    "fone": ["fone", "headset", "headphone", "earbuds", "earphone", "auricular"],
    "teclado": ["teclado"],
    "mouse": ["mouse"],
    "cadeira": ["cadeira"],
    "ssd": ["ssd"],
    "hd": ["hd ", "hd externo", "disco rigido"],
    "console": ["console", "playstation", "xbox", "nintendo switch"],
    "tablet": ["tablet", "ipad"],
    "impressora": ["impressora"],
    "roteador": ["roteador"],
    "webcam": ["webcam"],
    "caixa de som": ["caixa de som", "speaker"],
    "smartwatch": ["smartwatch", "relogio inteligente"],
    "geladeira": ["geladeira", "refrigerador"],
    "air fryer": ["air fryer", "fritadeira"],
}

# Características (sem número) que o usuário pode pedir
CARACTERISTICAS = {
    "Bluetooth": r"bluetooth",
    "Sem fio": r"sem fio|wireless",
    "Cancelamento de ruído": r"cancelamento (?:ativo )?de ruido|\banc\b|noise cancel",
    "NVMe": r"nvme",
    "IPS": r"\bips\b",
    "OLED": r"\boled\b",
    "VA": r"\bva\b",
    "4K": r"\b4k\b|uhd|3840",
    "Full HD": r"full ?hd|1080p|1920 ?x ?1080",
    "QHD": r"\bqhd\b|2k\b|1440p|2560 ?x ?1440",
    "Curvo": r"curv",
    "Mecânico": r"mecanic",
    "RGB": r"\brgb\b",
    "Gamer": r"gamer|gaming",
    "USB-C": r"usb[ -]?c\b|tipo[ -]?c",
    "Wi-Fi": r"wi-?fi",
    "5G": r"\b5g\b",
    "DDR5": r"ddr5",
    "DDR4": r"ddr4",
    "Inverter": r"inverter",
}

ACESSORIOS = r"\b(suporte|capa|capinha|pelicula|cabo|adaptador|case|protetor|refil|controle remoto|pe de|kit de limpeza|almofada|skin|adesivo)\b"

PRICE_RE = re.compile(
    r"(?:at[eé]|no\s+m[aá]ximo|m[aá]ximo(?:\s+de)?|abaixo\s+de|menos\s+de|por\s+at[eé]|"
    r"pagar|custando|or[cç]amento\s+de|r\$)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(mil|k)?(?:\s*reais)?",
    re.IGNORECASE,
)

UNIDADES = {
    "hz": "hz", "polegadas": "pol", "polegada": "pol", "pol": "pol", '"': "pol",
    "gb": "gb", "tb": "tb", "mah": "mah", "w": "w", "mp": "mp", "ms": "ms",
}
SPEC_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(hz|polegadas|polegada|pol|\"|gb|tb|mah|ms|mp|w)(?![a-z])")


def extract_price(text: str) -> float | None:
    m = PRICE_RE.search(text)
    if not m:
        return None
    value = parse_price(m.group(1))
    if value and m.group(2):
        value *= 1000
    return value


def extract_specs(text: str) -> list[tuple[float, str]]:
    return [(float(n.replace(",", ".")), UNIDADES[u]) for n, u in SPEC_RE.findall(norm(text))]


def spec_label(value: float, unit: str) -> str:
    n = f"{value:g}".replace(".", ",")
    return {"pol": f'{n}"', "hz": f"{n} Hz", "gb": f"{n} GB", "tb": f"{n} TB",
            "mah": f"{n} mAh", "ms": f"{n} ms", "mp": f"{n} MP", "w": f"{n} W"}[unit]


def detect_categoria(texto_norm: str, palavras: list[str]) -> str:
    for nome, aliases in CATEGORIAS.items():
        if nome in texto_norm or any(a.strip() in palavras or (" " in a and a in texto_norm) for a in aliases):
            return nome
    return next((w for w in palavras if not re.search(r"\d", w)), "")


def detect_caracteristicas(texto_norm: str) -> list[str]:
    return [nome for nome, rx in CARACTERISTICAS.items() if re.search(rx, texto_norm)]


# ---------------------------------------------------------------------------
# 1) Entender o pedido
# ---------------------------------------------------------------------------

def interpret(texto: str) -> dict:
    texto = (texto or "").strip()[:500]
    preco = extract_price(texto)
    sem_preco = PRICE_RE.sub(" ", texto)
    t = norm(sem_preco)
    specs = extract_specs(sem_preco)

    # "280 hz" -> "280hz" e 25" -> "25 polegadas" deixam a busca das lojas mais precisa
    busca = re.sub(r"(\d)\s+(hz|gb|tb)\b", r"\1\2", t)
    busca = re.sub(r'(\d)\s*"', r"\1 polegadas", busca)
    palavras = [w for w in re.findall(r"[\w\-]+", busca) if w not in STOPWORDS]
    termo = " ".join(palavras[:8]).strip() or texto

    categoria = detect_categoria(t, palavras)
    caracteristicas = detect_caracteristicas(t)
    requisitos = [spec_label(v, u) for v, u in specs] + caracteristicas

    resumo = f"Procurando {termo}"
    if preco:
        resumo += f" por até R$ {preco:,.0f}".replace(",", ".")
    return {"termo_busca": termo, "categoria": categoria, "requisitos": requisitos,
            "preco_maximo": preco, "resumo": resumo}


# ---------------------------------------------------------------------------
# 2) Filtrar anúncios
# ---------------------------------------------------------------------------

def _categoria_ok(titulo_norm: str, categoria: str) -> bool:
    if not categoria:
        return True
    aliases = CATEGORIAS.get(categoria, [categoria])
    return any(a.strip() in titulo_norm for a in aliases) or categoria[:5] in titulo_norm


def _modelos(termo: str) -> list[str]:
    """Códigos com número que não são medidas: '4060' em 'rtx 4060', 's24' em 'galaxy s24'."""
    sem_specs = SPEC_RE.sub(" ", norm(termo).replace("polegadas", '"'))
    sem_specs = SPEC_RE.sub(" ", sem_specs)
    return [c for c in re.findall(r"\b(?=\w*\d)\w+\b", sem_specs)]


def avaliar(titulo: str, interp: dict, specs: list[tuple[float, str]]) -> tuple[bool, list[str], int]:
    """Retorna (compatível?, motivos, quantas características bateram)."""
    t = norm(titulo)
    categoria = interp.get("categoria") or ""

    if not _categoria_ok(t, categoria):
        return False, [], 0
    if re.search(ACESSORIOS, t) and not re.search(ACESSORIOS, norm(interp.get("termo_busca") or "")):
        return False, [], 0

    compacto = t.replace(" ", "")
    for codigo in _modelos(interp.get("termo_busca") or ""):
        if codigo not in t and codigo not in compacto:
            return False, [], 0

    motivos = []
    t_specs = extract_specs(titulo)
    for valor, unidade in specs:
        tol = 0.6 if unidade == "pol" else 0.001
        achado = next((v for v, u in t_specs if u == unidade and abs(v - valor) <= tol), None)
        if achado is None:
            return False, [], 0
        motivos.append(spec_label(achado, unidade))

    feitas = 0
    for nome in interp.get("requisitos") or []:
        rx = CARACTERISTICAS.get(nome)
        if rx and re.search(rx, t):
            feitas += 1
            motivos.append(nome)
    return True, motivos, feitas


def filter_offers(texto: str, interp: dict, ofertas: list[dict]) -> list[dict]:
    """Devolve as ofertas compatíveis com o pedido, da mais barata para a mais cara."""
    specs = extract_specs(PRICE_RE.sub(" ", texto or ""))
    pedidas = [r for r in interp.get("requisitos") or [] if r in CARACTERISTICAS]

    avaliadas = []
    for o in ofertas:
        ok, motivos, feitas = avaliar(o["titulo"], interp, specs)
        if ok:
            avaliadas.append(({**o, "motivo": ", ".join(motivos) or "Corresponde à busca"}, feitas))

    # Se há anúncios suficientes com TODAS as características pedidas, mostra só eles.
    if pedidas:
        completos = [o for o, f in avaliadas if f == len(pedidas)]
        resultado = completos if len(completos) >= 3 else [o for o, _ in avaliadas]
    else:
        resultado = [o for o, _ in avaliadas]

    # Remove preços absurdamente baixos (normalmente peças/acessórios que escaparam).
    if len(resultado) >= 4:
        mediana = statistics.median(o["preco"] for o in resultado)
        resultado = [o for o in resultado if o["preco"] >= mediana * 0.25]

    return sorted(resultado, key=lambda o: o["preco"])

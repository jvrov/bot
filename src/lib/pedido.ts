/**
 * Entende pedidos em linguagem natural e filtra os anúncios compatíveis.
 * 100% gratuito: só regras próprias, nenhuma API paga.
 *
 *   "quero um monitor de 280hz de 25 polegadas até R$ 1.500"
 *   -> termo "monitor 280hz 25 polegadas", categoria "monitor",
 *      requisitos 280 Hz e 25", preço máximo 1500
 */
import { parsePrice } from './preco';
import type { Interpretacao, Oferta } from './types';

export function norm(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[”“]/g, '"')
    .replace(/''|´´/g, '"');
}

const STOPWORDS = new Set(
  `quero queria gostaria preciso procuro procurando busco buscando me um uma uns umas
  de do da dos das que com para pra por o a os as e ou em no na nos nas seja sendo tenha
  ter tem bom boa barato barata melhor mais menos ate maximo abaixo pagar ai
  custando custe valor preco reais r algum alguma comprar compra novo nova`.split(/\s+/),
);

export const CATEGORIAS: Record<string, string[]> = {
  'placa de video': ['placa de video', 'placa video', 'gpu', 'geforce', 'radeon'],
  'placa mae': ['placa mae', 'placa-mae', 'motherboard'],
  fonte: ['fonte'],
  processador: ['processador', 'cpu', 'ryzen', 'core i'],
  'memoria ram': ['memoria', 'ram', 'ddr4', 'ddr5'],
  monitor: ['monitor'],
  notebook: ['notebook', 'laptop'],
  celular: ['celular', 'smartphone', 'iphone', 'galaxy'],
  'smart tv': ['smart tv', 'tv', 'televisao', 'televisor'],
  fone: ['fone', 'headset', 'headphone', 'earbuds', 'earphone', 'auricular'],
  teclado: ['teclado'],
  mouse: ['mouse'],
  cadeira: ['cadeira'],
  ssd: ['ssd'],
  hd: ['hd externo', 'disco rigido'],
  console: ['console', 'playstation', 'xbox', 'nintendo switch'],
  tablet: ['tablet', 'ipad'],
  impressora: ['impressora'],
  roteador: ['roteador'],
  webcam: ['webcam'],
  'caixa de som': ['caixa de som', 'speaker'],
  smartwatch: ['smartwatch', 'relogio inteligente'],
  geladeira: ['geladeira', 'refrigerador'],
  'air fryer': ['air fryer', 'fritadeira'],
};

export const CARACTERISTICAS: Record<string, RegExp> = {
  Bluetooth: /bluetooth/,
  'Sem fio': /sem fio|wireless/,
  'Cancelamento de ruído': /cancelamento (?:ativo )?de ruido|\banc\b|noise cancel/,
  NVMe: /nvme/,
  IPS: /\bips\b/,
  OLED: /\boled\b/,
  '4K': /\b4k\b|uhd|3840/,
  'Full HD': /full ?hd|1080p|1920 ?x ?1080/,
  QHD: /\bqhd\b|\b2k\b|1440p|2560 ?x ?1440/,
  Curvo: /curv/,
  Mecânico: /mecanic/,
  RGB: /\brgb\b/,
  Gamer: /gamer|gaming/,
  'USB-C': /usb[ -]?c\b|tipo[ -]?c/,
  'Wi-Fi': /wi-?fi/,
  '5G': /\b5g\b/,
  DDR5: /ddr5/,
  DDR4: /ddr4/,
  Inverter: /inverter/,
};

const ACESSORIOS =
  /\b(suporte|capa|capinha|pelicula|cabo|adaptador|case|protetor|refil|controle remoto|kit de limpeza|almofada|skin|adesivo)\b/;

const PRICE_RE =
  /(?:at[eé]|no\s+m[aá]ximo|m[aá]ximo(?:\s+de)?|abaixo\s+de|menos\s+de|por\s+at[eé]|pagar|custando|or[cç]amento\s+de|r\$)\s*(?:r\$\s*)?(\d[\d.,]*)\s*(mil|k)?(?:\s*reais)?/i;

const PRICE_RE_G = new RegExp(PRICE_RE.source, 'gi');

const UNIDADES: Record<string, string> = {
  hz: 'hz', polegadas: 'pol', polegada: 'pol', pol: 'pol', '"': 'pol',
  gb: 'gb', tb: 'tb', mah: 'mah', w: 'w', mp: 'mp', ms: 'ms',
};
const SPEC_RE = /(\d+(?:[.,]\d+)?)\s*(hz|polegadas|polegada|pol|"|gb|tb|mah|ms|mp|w)(?![a-z])/g;

export type Spec = [number, string];

export function extractPrice(text: string): number | null {
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  let v = parsePrice(m[1]);
  if (v && m[2]) v *= 1000;
  return v;
}

export function extractSpecs(text: string): Spec[] {
  return [...norm(text).matchAll(SPEC_RE)].map((m) => [Number(m[1].replace(',', '.')), UNIDADES[m[2]]] as Spec);
}

export function specLabel(v: number, u: string): string {
  const n = String(v).replace('.', ',');
  return ({ pol: `${n}"`, hz: `${n} Hz`, gb: `${n} GB`, tb: `${n} TB`, mah: `${n} mAh`, ms: `${n} ms`, mp: `${n} MP`, w: `${n} W` } as Record<string, string>)[u];
}

function detectCategoria(t: string, palavras: string[]): string {
  for (const [nome, aliases] of Object.entries(CATEGORIAS)) {
    if (t.includes(nome) || aliases.some((a) => palavras.includes(a) || (a.includes(' ') && t.includes(a)))) return nome;
  }
  return palavras.find((w) => !/\d/.test(w)) ?? '';
}

// ---------------------------------------------------------------------------
// 1) Entender o pedido
// ---------------------------------------------------------------------------

export function interpret(textoBruto: string): Interpretacao {
  const texto = (textoBruto || '').trim().slice(0, 500);
  const preco = extractPrice(texto);
  const semPreco = texto.replace(PRICE_RE_G, ' ');
  const t = norm(semPreco);
  const specs = extractSpecs(semPreco);

  // "280 hz" -> "280hz" e 25" -> "25 polegadas" deixam a busca das lojas mais precisa
  const busca = t.replace(/(\d)\s+(hz|gb|tb)\b/g, '$1$2').replace(/(\d)\s*"/g, '$1 polegadas');
  const palavras = (busca.match(/[\w-]+/g) ?? []).filter((w) => !STOPWORDS.has(w));
  const termo = palavras.slice(0, 8).join(' ').trim() || texto;

  const caracteristicas = Object.entries(CARACTERISTICAS).filter(([, rx]) => rx.test(t)).map(([n]) => n);
  let resumo = `Procurando ${termo}`;
  if (preco) resumo += ` por até R$ ${Math.round(preco).toLocaleString('pt-BR')}`;

  return {
    termo_busca: termo,
    categoria: detectCategoria(t, palavras),
    requisitos: [...specs.map(([v, u]) => specLabel(v, u)), ...caracteristicas],
    preco_maximo: preco,
    resumo,
  };
}

// ---------------------------------------------------------------------------
// 2) Filtrar e enriquecer anúncios
// ---------------------------------------------------------------------------

function categoriaOk(titulo: string, categoria: string): boolean {
  if (!categoria) return true;
  const aliases = CATEGORIAS[categoria] ?? [categoria];
  return aliases.some((a) => titulo.includes(a)) || titulo.includes(categoria.slice(0, 5));
}

/** Códigos com número que não são medidas: "4060" em "rtx 4060". */
function modelos(termo: string): string[] {
  const semSpecs = norm(termo).replace(/polegadas/g, '"').replace(SPEC_RE, ' ');
  return semSpecs.match(/\b(?=\w*\d)\w+\b/g) ?? [];
}

export function avaliar(titulo: string, interp: Interpretacao, specs: Spec[]): { ok: boolean; motivos: string[]; pontos: number } {
  const t = norm(titulo);
  const nao = { ok: false, motivos: [], pontos: 0 };
  if (!categoriaOk(t, interp.categoria)) return nao;
  if (ACESSORIOS.test(t) && !ACESSORIOS.test(norm(interp.termo_busca))) return nao;
  const compacto = t.replace(/\s/g, '');
  if (modelos(interp.termo_busca).some((c) => !t.includes(c) && !compacto.includes(c))) return nao;

  const motivos: string[] = [];
  const tSpecs = extractSpecs(titulo);
  for (const [valor, unidade] of specs) {
    const tol = unidade === 'pol' ? 0.6 : 0.001;
    const achado = tSpecs.find(([v, u]) => u === unidade && Math.abs(v - valor) <= tol);
    if (!achado) return nao;
    motivos.push(specLabel(achado[0], unidade));
  }
  let pontos = 0;
  for (const nome of interp.requisitos) {
    const rx = CARACTERISTICAS[nome];
    if (rx && rx.test(t)) {
      pontos++;
      motivos.push(nome);
    }
  }
  return { ok: true, motivos, pontos };
}

/** Recência estimada pelo código do anúncio, comparando só anúncios da mesma loja. */
export function calcularRecencia(ofertas: Oferta[]): Oferta[] {
  const porLoja = new Map<string, number[]>();
  for (const o of ofertas) {
    if (o.codigo) porLoja.set(o.loja, [...(porLoja.get(o.loja) ?? []), o.codigo]);
  }
  return ofertas.map((o) => {
    const codigos = porLoja.get(o.loja);
    if (!o.codigo || !codigos || codigos.length < 2) return { ...o, recencia: null };
    const menores = codigos.filter((c) => c < o.codigo!).length;
    return { ...o, recencia: menores / (codigos.length - 1) };
  });
}

export function filterOffers(texto: string, interp: Interpretacao, ofertas: Oferta[]): Oferta[] {
  const specs = extractSpecs((texto || '').replace(PRICE_RE_G, ' '));
  const pedidas = interp.requisitos.filter((r) => r in CARACTERISTICAS);

  const avaliadas: Oferta[] = [];
  for (const o of ofertas) {
    const r = avaliar(o.titulo, interp, specs);
    if (r.ok) avaliadas.push({ ...o, motivo: r.motivos.join(', ') || 'Corresponde à busca', pontos: r.pontos });
  }

  // Se há anúncios suficientes com TODAS as características pedidas, mostra só eles.
  let resultado = avaliadas;
  if (pedidas.length) {
    const completos = avaliadas.filter((o) => o.pontos === pedidas.length);
    if (completos.length >= 3) resultado = completos;
  }

  // Remove preços absurdamente baixos (peças/acessórios que escaparam).
  if (resultado.length >= 4) {
    const precos = resultado.map((o) => o.preco).sort((a, b) => a - b);
    const mediana = precos[Math.floor(precos.length / 2)];
    resultado = resultado.filter((o) => o.preco >= mediana * 0.25);
  }
  return calcularRecencia(resultado).sort((a, b) => a.preco - b.preco);
}

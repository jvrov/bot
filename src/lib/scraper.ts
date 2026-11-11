/** Lê preço, nome e imagem da página de UM produto. */
import * as cheerio from 'cheerio';
import { isValidUrl, parsePrice } from './preco';
import type { Loja, ScrapeResult } from './types';

export const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

export const TIMEOUT_MS = 12_000;

export function detectStore(url: string): Loja | null {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.includes('amazon.')) return 'amazon';
  if (host.includes('mercadolivre') || host.includes('mercadolibre')) return 'mercadolivre';
  if (host.includes('kabum')) return 'kabum';
  if (host.includes('magazineluiza') || host.includes('magalu')) return 'magazineluiza';
  return null;
}

const STORE_SELECTORS: Record<Loja, string[]> = {
  amazon: [
    '#corePriceDisplay_desktop_feature_div .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    'span.a-price span.a-offscreen',
  ],
  mercadolivre: ['.ui-pdp-price__second-line .andes-money-amount', 'meta[itemprop=price]', '.andes-money-amount'],
  kabum: ['h4.finalPrice', '[class*=finalPrice]'],
  magazineluiza: ['[data-testid=price-value]', 'p.price-template__text'],
};

type Json = unknown;

/** Percorre um JSON e devolve todos os objetos (decodificando strings com JSON). */
export function* walkJson(obj: Json, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 40 || obj == null) return;
  if (typeof obj === 'string') {
    const s = obj.trim();
    if (s.length > 50 && (s[0] === '{' || s[0] === '[')) {
      try {
        yield* walkJson(JSON.parse(s), depth + 1);
      } catch {
        /* não era JSON */
      }
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) yield* walkJson(v, depth + 1);
  } else if (typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    yield rec;
    for (const v of Object.values(rec)) yield* walkJson(v, depth + 1);
  }
}

export function jsonLdBlocks($: cheerio.CheerioAPI): Json[] {
  const out: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      out.push(JSON.parse($(el).text()));
    } catch {
      /* ignora */
    }
  });
  return out;
}

const isProduct = (d: Record<string, unknown>) => {
  const t = d['@type'];
  return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
};

export function priceFromOffers(offers: unknown): number | null {
  if (Array.isArray(offers)) {
    const prices = offers.map(priceFromOffers).filter((p): p is number => p != null);
    return prices.length ? Math.min(...prices) : null;
  }
  if (offers && typeof offers === 'object') {
    const o = offers as Record<string, unknown>;
    return parsePrice(o.price) ?? parsePrice(o.lowPrice) ?? (o.priceSpecification ? priceFromOffers(o.priceSpecification) : null);
  }
  return null;
}

function imageOf(v: unknown): string | null {
  if (Array.isArray(v)) return imageOf(v[0]);
  if (typeof v === 'string') return isValidUrl(v) ? v : null;
  if (v && typeof v === 'object') return imageOf((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl);
  return null;
}

/** Extrai preço, nome e imagem de um HTML já baixado. */
export function extractFromHtml(html: string, url = ''): ScrapeResult {
  const $ = cheerio.load(html);
  const name = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim() || null;
  const image = imageOf($('meta[property="og:image"]').attr('content'));

  const store = detectStore(url);
  for (const sel of store ? STORE_SELECTORS[store] : []) {
    for (const el of $(sel).toArray()) {
      const node = $(el);
      const price = parsePrice(node.attr('content') || node.text());
      if (price) return { price, name, image };
    }
  }

  for (const block of jsonLdBlocks($)) {
    for (const d of walkJson(block)) {
      if (!isProduct(d)) continue;
      const price = priceFromOffers(d.offers);
      if (price) {
        return { price, name: typeof d.name === 'string' ? d.name : name, image: imageOf(d.image) ?? image };
      }
    }
  }

  for (const sel of ['[itemprop=price]', 'meta[property="product:price:amount"]', 'meta[property="og:price:amount"]']) {
    const node = $(sel).first();
    if (node.length) {
      const price = parsePrice(node.attr('content') || node.text());
      if (price) return { price, name, image };
    }
  }
  return { price: null, name, image, error: 'Preço não encontrado na página' };
}

export async function fetchHtml(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  } catch {
    throw new Error('a loja não respondeu');
  }
  if (res.status >= 400) throw new Error(`a loja respondeu HTTP ${res.status}`);
  return res.text();
}

export async function fetchProduct(url: string): Promise<ScrapeResult> {
  if (!isValidUrl(url)) return { price: null, error: 'URL inválida' };
  try {
    return extractFromHtml(await fetchHtml(url), url);
  } catch (e) {
    return { price: null, error: `Não foi possível acessar a página (${(e as Error).message})` };
  }
}

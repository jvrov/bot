/** Busca de produtos nas lojas a partir de um termo (ex.: "monitor 280hz 25 polegadas"). */
import * as cheerio from 'cheerio';
import { isValidUrl, parsePrice, round2 } from './preco';
import { fetchHtml, jsonLdBlocks, priceFromOffers, walkJson } from './scraper';
import type { Loja, Oferta } from './types';

export const MAX_POR_LOJA = 24;

const BASE: Record<Loja, string> = {
  kabum: 'https://www.kabum.com.br',
  mercadolivre: 'https://www.mercadolivre.com.br',
  amazon: 'https://www.amazon.com.br',
  magazineluiza: 'https://www.magazineluiza.com.br',
};

export function slugify(term: string): string {
  return term
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function oferta(
  titulo: unknown,
  preco: unknown,
  url: string | null,
  loja: Loja,
  imagem?: unknown,
  codigo?: number | null,
): Oferta | null {
  const t = typeof titulo === 'string' ? titulo.replace(/\s+/g, ' ').trim() : '';
  const p = parsePrice(preco);
  if (!t || !p || !url || !isValidUrl(url)) return null;
  const img = typeof imagem === 'string' && isValidUrl(imagem) ? imagem : null;
  return { titulo: t.slice(0, 220), preco: round2(p), url, loja, imagem: img, codigo: codigo ?? null };
}

function finalizar(lista: (Oferta | null)[]): Oferta[] {
  const vistos = new Set<string>();
  const out: Oferta[] = [];
  for (const o of lista) {
    if (o && !vistos.has(o.url)) {
      vistos.add(o.url);
      out.push({ ...o, posicao: out.length });
    }
  }
  return out.slice(0, MAX_POR_LOJA);
}

const first = (d: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = d[k];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) return v;
  }
  return undefined;
};

function priceOf(d: Record<string, unknown>): unknown {
  const v = first(d, 'priceWithDiscount', 'bestPrice', 'salePrice', 'price', 'lowPrice', 'value');
  if (v && typeof v === 'object' && !Array.isArray(v)) return priceOf(v as Record<string, unknown>);
  return Array.isArray(v) ? undefined : v;
}

function imageOf(d: Record<string, unknown>): string | null {
  let v = first(d, 'image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'img', 'picture');
  if (Array.isArray(v)) v = v[0];
  if (v && typeof v === 'object') v = first(v as Record<string, unknown>, 'url', 'src', 'contentUrl');
  return typeof v === 'string' ? v.replace('{w}x{h}', '300x300') : null;
}

function nextData($: cheerio.CheerioAPI): unknown {
  const raw = $('script#__NEXT_DATA__').text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Procura objetos com cara de produto (nome + preço + link) em qualquer JSON. */
export function harvestJson(
  data: unknown,
  loja: Loja,
  build: (d: Record<string, unknown>) => { url: string | null; codigo?: number | null },
): Oferta[] {
  const out: (Oferta | null)[] = [];
  for (const d of walkJson(data)) {
    const titulo = first(d, 'name', 'title', 'productName');
    if (typeof titulo !== 'string') continue;
    const preco = priceOf(d);
    if (preco == null || typeof preco === 'boolean') continue;
    const { url, codigo } = build(d);
    if (url) out.push(oferta(titulo, preco, url, loja, imageOf(d), codigo));
  }
  return finalizar(out);
}

function jsonLdOffers($: cheerio.CheerioAPI, loja: Loja): Oferta[] {
  const out: (Oferta | null)[] = [];
  for (const block of jsonLdBlocks($)) {
    for (const d of walkJson(block)) {
      const t = d['@type'];
      if (!(t === 'Product' || (Array.isArray(t) && t.includes('Product')))) continue;
      let offers = d.offers as unknown;
      if (Array.isArray(offers)) offers = offers[0];
      const o = (offers ?? {}) as Record<string, unknown>;
      const link = (d.url ?? o.url) as string | undefined;
      if (link) out.push(oferta(d.name, priceFromOffers(o), new URL(link, BASE[loja]).href, loja, imageOf(d)));
    }
  }
  return finalizar(out);
}

// ---------------------------------------------------------------------------
// Lojas
// ---------------------------------------------------------------------------

export function parseKabum(html: string): Oferta[] {
  const $ = cheerio.load(html);
  const data = nextData($);
  const found = data
    ? harvestJson(data, 'kabum', (d) => {
        const code = d.code ?? d.id;
        const friendly = d.friendlyName ?? d.slug;
        if (code != null && /^\d+$/.test(String(code)) && friendly) {
          return { url: `${BASE.kabum}/produto/${code}/${friendly}`, codigo: Number(code) };
        }
        const link = d.link ?? d.url;
        return typeof link === 'string' && link.includes('/produto/') ? { url: new URL(link, BASE.kabum).href } : { url: null };
      })
    : [];
  if (found.length) return found;
  return jsonLdOffers($, 'kabum').map((o) => ({ ...o, codigo: Number(o.url.match(/\/produto\/(\d+)/)?.[1]) || null }));
}

export function mlCodigo(url: string): number | null {
  const m = url.match(/MLB-?(\d{6,})/i);
  return m ? Number(m[1]) : null;
}

export function parseMercadoLivre(html: string): Oferta[] {
  const $ = cheerio.load(html);
  const out: (Oferta | null)[] = [];
  $('li.ui-search-layout__item, div.poly-card, div.ui-search-result__wrapper').each((_, el) => {
    const card = $(el);
    const link = card.find('a.poly-component__title, h3 a, h2 a, a.ui-search-link').first();
    const href = link.attr('href');
    if (!href) return;
    const box = card.find('.poly-price__current, .ui-search-price__second-line').first();
    const scope = box.length ? box : card;
    const frac = scope.find('.andes-money-amount__fraction').first().text().trim();
    if (!frac) return;
    const cents = scope.find('.andes-money-amount__cents').first().text().trim();
    const price = frac.replace(/\./g, '') + (cents ? `,${cents}` : '');
    const img = card.find('img').first();
    let image = img.attr('data-src') || img.attr('src') || null;
    if (image?.startsWith('data:')) image = null;
    const url = href.split('#')[0];
    out.push(oferta(link.text(), price, url, 'mercadolivre', image, mlCodigo(url)));
  });
  const found = finalizar(out);
  return found.length ? found : jsonLdOffers($, 'mercadolivre').map((o) => ({ ...o, codigo: mlCodigo(o.url) }));
}

export function parseAmazon(html: string): Oferta[] {
  const $ = cheerio.load(html);
  const out: (Oferta | null)[] = [];
  $('div[data-component-type="s-search-result"]').each((_, el) => {
    const card = $(el);
    const asin = card.attr('data-asin');
    const h2 = card.find('h2').first();
    const title = h2.attr('aria-label') || h2.text();
    const price = card.find('span.a-price:not(.a-text-price) span.a-offscreen').first().text();
    if (!asin || !title || !price) return;
    out.push(oferta(title, price, `${BASE.amazon}/dp/${asin}`, 'amazon', card.find('img.s-image').attr('src')));
  });
  return finalizar(out);
}

export function parseMagalu(html: string): Oferta[] {
  const $ = cheerio.load(html);
  const data = nextData($);
  const found = data
    ? harvestJson(data, 'magazineluiza', (d) => {
        const path = first(d, 'url', 'path', 'link');
        if (typeof path === 'string' && (path.includes('/p/') || path.startsWith('p/'))) {
          return { url: new URL(path.replace(/^\/+/, ''), `${BASE.magazineluiza}/`).href };
        }
        return { url: null };
      })
    : [];
  return found.length ? found : jsonLdOffers($, 'magazineluiza');
}

export const STORES: Record<Loja, { url: (t: string) => string; parse: (html: string) => Oferta[] }> = {
  kabum: { url: (t) => `${BASE.kabum}/busca/${encodeURIComponent(slugify(t))}`, parse: parseKabum },
  mercadolivre: { url: (t) => `https://lista.mercadolivre.com.br/${encodeURIComponent(slugify(t))}`, parse: parseMercadoLivre },
  amazon: { url: (t) => `${BASE.amazon}/s?k=${encodeURIComponent(t)}`, parse: parseAmazon },
  magazineluiza: { url: (t) => `${BASE.magazineluiza}/busca/${encodeURIComponent(t)}/`, parse: parseMagalu },
};

export const LOJAS_BUSCA = Object.keys(STORES) as Loja[];

export async function searchStore(loja: Loja, termo: string): Promise<Oferta[]> {
  const store = STORES[loja];
  if (!store) throw new Error('loja não suportada');
  const html = await fetchHtml(store.url(termo));
  try {
    return store.parse(html);
  } catch (e) {
    console.error(`Falha ao ler resultados de ${loja}`, e);
    throw new Error('não consegui ler a página de resultados');
  }
}

/** Busca em todas as lojas em paralelo. */
export async function searchAll(termo: string): Promise<{ ofertas: Oferta[]; erros: Partial<Record<Loja, string>> }> {
  const erros: Partial<Record<Loja, string>> = {};
  const listas = await Promise.all(
    LOJAS_BUSCA.map(async (loja) => {
      try {
        return await searchStore(loja, termo);
      } catch (e) {
        erros[loja] = (e as Error).message;
        return [];
      }
    }),
  );
  return { ofertas: listas.flat(), erros };
}

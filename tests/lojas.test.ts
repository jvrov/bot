import { describe, expect, it } from 'vitest';
import { mlCodigo, parseAmazon, parseKabum, parseMagalu, parseMercadoLivre } from '@/lib/search';

const nextData = (obj: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script>`;

describe('leitores das páginas de busca', () => {
  it('KaBuM!: __NEXT_DATA__ com JSON dentro de string', () => {
    const catalog = { catalogServer: { data: [
      { code: 123, name: 'Monitor Gamer 24.5 280Hz', price: 1399.9, priceWithDiscount: 1189.9, friendlyName: 'monitor-gamer', image: 'https://img.kabum.com.br/1.jpg' },
      { code: 456, name: 'Monitor 2', priceWithDiscount: 999, friendlyName: 'monitor-2' },
    ] } };
    const out = parseKabum(nextData({ props: { pageProps: { data: JSON.stringify(catalog) } } }));
    expect(out[0]).toEqual({
      titulo: 'Monitor Gamer 24.5 280Hz', preco: 1189.9, url: 'https://www.kabum.com.br/produto/123/monitor-gamer',
      loja: 'kabum', imagem: 'https://img.kabum.com.br/1.jpg', codigo: 123, posicao: 0,
    });
    expect(out).toHaveLength(2);
  });

  it('KaBuM!: cai no JSON-LD se não houver __NEXT_DATA__', () => {
    const data = { '@type': 'ItemList', itemListElement: [{ item: { '@type': 'Product', name: 'SSD 1TB', url: '/produto/9/ssd', offers: { price: '399.90' } } }] };
    const out = parseKabum(`<script type="application/ld+json">${JSON.stringify(data)}</script>`);
    expect(out[0]).toMatchObject({ url: 'https://www.kabum.com.br/produto/9/ssd', preco: 399.9, codigo: 9 });
  });

  it('Mercado Livre: cards poly', () => {
    const html = `<ol><li class="ui-search-layout__item"><div class="poly-card">
      <img data-src="https://http2.mlstatic.com/a.webp" src="data:image/gif;base64,xx">
      <h3><a class="poly-component__title" href="https://produto.mercadolivre.com.br/MLB-3456789012-monitor#pos">Monitor 280Hz 24,5</a></h3>
      <div class="poly-price__current"><span class="andes-money-amount__fraction">1.249</span><span class="andes-money-amount__cents">90</span></div>
    </div></li></ol>`;
    expect(parseMercadoLivre(html)).toEqual([{
      titulo: 'Monitor 280Hz 24,5', preco: 1249.9, url: 'https://produto.mercadolivre.com.br/MLB-3456789012-monitor',
      loja: 'mercadolivre', imagem: 'https://http2.mlstatic.com/a.webp', codigo: 3456789012, posicao: 0,
    }]);
    expect(mlCodigo('https://www.mercadolivre.com.br/p/MLB19876543')).toBe(19876543);
  });

  it('Amazon: resultados da busca', () => {
    const html = `<div data-component-type="s-search-result" data-asin="B0TEST">
      <img class="s-image" src="https://m.media-amazon.com/x.jpg">
      <h2 aria-label="Monitor Gamer 25 280Hz"><span>Monitor Gamer 25 280Hz</span></h2>
      <span class="a-price"><span class="a-offscreen">R$ 1.099,00</span></span>
      <span class="a-price a-text-price"><span class="a-offscreen">R$ 1.599,00</span></span></div>`;
    expect(parseAmazon(html)[0]).toMatchObject({ preco: 1099, url: 'https://www.amazon.com.br/dp/B0TEST' });
  });

  it('Magalu: __NEXT_DATA__', () => {
    const html = nextData({ props: { pageProps: { data: { search: { products: [{
      title: 'Monitor Gamer 25', url: 'monitor-gamer/p/abc123/in/mgam/',
      price: { fullPrice: '1500.00', bestPrice: '1299.00' }, image: 'https://a-static.mlcdn.com.br/{w}x{h}/x.jpg',
    }] } } } } });
    expect(parseMagalu(html)[0]).toMatchObject({
      preco: 1299, url: 'https://www.magazineluiza.com.br/monitor-gamer/p/abc123/in/mgam/', imagem: 'https://a-static.mlcdn.com.br/300x300/x.jpg',
    });
  });
});

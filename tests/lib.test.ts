import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as notifier from '@/lib/notifier';
import * as monitor from '@/lib/monitor';
import * as search from '@/lib/search';
import { brl, parsePrice } from '@/lib/preco';
import { calcularRecencia, extractPrice, filterOffers, interpret } from '@/lib/pedido';
import { detectStore, extractFromHtml } from '@/lib/scraper';
import type { Oferta } from '@/lib/types';

const of = (titulo: string, preco: number, extra: Partial<Oferta> = {}): Oferta => ({
  titulo, preco, url: `https://x.com/${encodeURIComponent(titulo)}`, loja: 'kabum', imagem: null, ...extra,
});

describe('parsePrice', () => {
  it.each([
    ['R$ 1.234,56', 1234.56], ['R$ 899,90', 899.9], ['1234.56', 1234.56], ['1.299', 1299],
    ['1,299.99', 1299.99], ['2.499.000', 2499000], ['  59,9 ', 59.9], [1500, 1500],
    ['', null], ['grátis', null], ['0,00', null], [null, null],
  ])('%s -> %s', (entrada, esperado) => expect(parsePrice(entrada)).toBe(esperado));

  it('formata em reais', () => expect(brl(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50'));
});

describe('scraper', () => {
  it('detecta lojas', () => {
    expect(detectStore('https://www.kabum.com.br/produto/1')).toBe('kabum');
    expect(detectStore('https://produto.mercadolivre.com.br/MLB-1')).toBe('mercadolivre');
    expect(detectStore('https://example.com')).toBeNull();
  });
  it('lê seletor da KaBuM', () => {
    const r = extractFromHtml('<title>PS5</title><h4 class="finalPrice">R$ 3.499,90</h4>', 'https://www.kabum.com.br/produto/1');
    expect(r).toMatchObject({ price: 3499.9, name: 'PS5' });
  });
  it('lê JSON-LD de qualquer loja', () => {
    const data = { '@graph': [{ '@type': ['Product'], name: 'SSD', image: 'https://i/x.jpg', offers: [{ price: 400 }, { price: 350.5 }] }] };
    const r = extractFromHtml(`<script type="application/ld+json">${JSON.stringify(data)}</script>`, 'https://x.com');
    expect(r).toMatchObject({ price: 350.5, name: 'SSD', image: 'https://i/x.jpg' });
  });
  it('avisa quando não acha preço', () => {
    expect(extractFromHtml('<p>nada</p>', 'https://x.com').price).toBeNull();
  });
});

describe('entender o pedido', () => {
  it('monitor com medidas e preço', () => {
    const r = interpret('quero um monitor de 280hz de 25 polegadas até R$ 1.500');
    expect(r.preco_maximo).toBe(1500);
    expect(r.termo_busca).toBe('monitor 280hz 25 polegadas');
    expect(r.categoria).toBe('monitor');
    expect(r.requisitos).toEqual(['280 Hz', '25"']);
  });
  it.each([
    ['ssd 1tb até 400 reais', 400], ['notebook no máximo 3 mil', 3000],
    ['fone bluetooth abaixo de R$ 299,90', 299.9], ['placa de vídeo rtx 4060', null],
  ])('preço em "%s"', (t, p) => expect(extractPrice(t)).toBe(p));

  it('fone com sinônimos e características', () => {
    const r = interpret('fone bluetooth com cancelamento de ruído até 500 reais');
    expect(r.categoria).toBe('fone');
    expect(r.requisitos).toEqual(['Bluetooth', 'Cancelamento de ruído']);
    const out = filterOffers('fone bluetooth com cancelamento de ruído', r, [
      of('Headset Bluetooth JBL Tune com Cancelamento de Ruído', 399),
      of('Fone Sony WH-1000XM4 Bluetooth Noise Cancelling ANC', 450),
      of('Fone de Ouvido Bluetooth com ANC Xiaomi', 199),
      of('Fone Bluetooth simples', 59),
      of('Capa para fone bluetooth com cancelamento de ruido', 19),
      of('Teclado bluetooth', 99),
    ]);
    expect(out.map((o) => o.preco)).toEqual([199, 399, 450]);
    expect(out[0].motivo).toContain('Bluetooth');
  });
});

describe('filtrar anúncios', () => {
  it('aceita 24,5" para 25 polegadas e recusa acessórios e medidas erradas', () => {
    const r = interpret('monitor 280hz 25 polegadas');
    const out = filterOffers('monitor 280hz 25 polegadas', r, [
      of('Monitor Gamer AOC 24,5" 280Hz IPS 1ms', 1199),
      of('Monitor Gamer 27 polegadas 280Hz', 1500),
      of('Monitor 24.5" 180Hz', 900),
      of('Suporte articulado para monitor 25" 280hz', 99),
      of('Monitor LG UltraGear 25 pol 280 Hz', 1300),
    ]);
    expect(out.map((o) => o.titulo)).toEqual(['Monitor Gamer AOC 24,5" 280Hz IPS 1ms', 'Monitor LG UltraGear 25 pol 280 Hz']);
    expect(out[0].motivo).toBe('280 Hz, 24,5"');
  });
  it('exige o número do modelo (RTX 4060)', () => {
    const r = interpret('placa de vídeo RTX 4060');
    expect(r.categoria).toBe('placa de video');
    const out = filterOffers('placa de vídeo RTX 4060', r, [
      of('Placa de Vídeo MSI GeForce RTX 4060 Ventus 8GB', 1900), of('GPU Gigabyte RTX 4060 Eagle', 1850),
      of('Placa de Vídeo RTX 3060 12GB', 1500), of('Placa Mãe B550', 700),
    ]);
    expect(out.map((o) => o.preco)).toEqual([1850, 1900]);
  });
  it('remove preços absurdamente baixos', () => {
    const r = interpret('ssd 1tb');
    const out = filterOffers('ssd 1tb', r, [400, 420, 450, 39.9].map((p, i) => of(`SSD 1TB modelo ${i}`, p)));
    expect(out.map((o) => o.preco)).not.toContain(39.9);
  });
  it('estima recência pelo código do anúncio dentro de cada loja', () => {
    const out = calcularRecencia([
      of('a', 1, { codigo: 100 }), of('b', 1, { codigo: 300 }), of('c', 1, { codigo: 200 }),
      of('d', 1, { loja: 'amazon' }), of('e', 1, { loja: 'mercadolivre', codigo: 5 }),
    ]);
    expect(out.map((o) => o.recencia)).toEqual([0, 1, 0.5, null, null]);
  });
});

describe('monitoramento', () => {
  let enviados: number[];
  beforeEach(() => {
    enviados = [];
    vi.spyOn(notifier, 'enviarAlerta').mockImplementation(async (_e, _p, preco) => { enviados.push(preco); return true; });
  });
  afterEach(() => vi.restoreAllMocks());

  it('envia um alerta por queda e guarda histórico', async () => {
    const p = monitor.novoProduto('TV', 'https://x.com/tv', 1000);
    expect((await monitor.aplicarResultado(p, { price: 1200 }, 'a@b.com')).status).toBe('monitorado');
    expect((await monitor.aplicarResultado(p, { price: 950 }, 'a@b.com')).status).toBe('alerta_enviado');
    expect((await monitor.aplicarResultado(p, { price: 900 }, 'a@b.com')).status).toBe('abaixo_do_alvo');
    await monitor.aplicarResultado(p, { price: 1100 }, 'a@b.com');
    expect((await monitor.aplicarResultado(p, { price: 990 }, 'a@b.com')).status).toBe('alerta_enviado');
    expect(enviados).toEqual([950, 990]);
    expect(p.preco_minimo).toBe(900);
    expect(p.preco_inicial).toBe(1200);
    expect(p.historico).toHaveLength(5);
  });

  it('erro mantém o último preço', async () => {
    const p = monitor.novoProduto('TV', 'https://x.com/tv', 1000);
    await monitor.aplicarResultado(p, { price: 1200 }, null);
    const r = await monitor.aplicarResultado(p, { price: null, error: 'bloqueado' }, null);
    expect(r.status).toBe('erro');
    expect(p.preco_atual).toBe(1200);
  });

  it('migra dados da versão antiga', () => {
    const p = monitor.normalizar({ nome: 'X', url: 'https://www.kabum.com.br/a', preco_alvo: 10 });
    expect(p.preco_desejado).toBe(10);
    expect(p.loja).toBe('kabum');
    expect(p.id).toHaveLength(12);
  });

  it('alerta de busca usa a melhor oferta compatível e marca novidades', async () => {
    const texto = 'monitor 280hz 25 polegadas';
    const p = monitor.novaBusca(texto, interpret(texto), 1000);
    const ofertasDia1 = [
      of('Monitor 24,5" 280Hz', 1100, { url: 'https://a/1' }),
      of('Suporte monitor 280hz 25 polegadas', 50, { url: 'https://a/3' }),
    ];
    vi.spyOn(search, 'searchAll').mockResolvedValueOnce({ ofertas: ofertasDia1, erros: {} });
    let [r] = await monitor.verificar([p], 'a@b.com');
    expect(r.status).toBe('monitorado');
    expect(p.novidades).toBe(0);

    vi.spyOn(search, 'searchAll').mockResolvedValueOnce({
      ofertas: [...ofertasDia1, of('Monitor 24,5" 280Hz Pro', 990, { url: 'https://a/2', loja: 'amazon' })], erros: {},
    });
    [r] = await monitor.verificar([p], 'a@b.com');
    expect(r).toMatchObject({ status: 'alerta_enviado', preco_atual: 990 });
    expect(p.melhor_oferta?.url).toBe('https://a/2');
    expect(p.novidades).toBe(1);
    expect(p.ofertas?.find((o) => o.url === 'https://a/2')?.novo).toBe(true);
    expect(notifier.montarAlerta('a@b.com', p, 990).text).toContain('Oferta encontrada');
  });
});

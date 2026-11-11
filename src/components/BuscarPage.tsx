'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Bell, Check, CircleDashed, ExternalLink, Link2, LoaderCircle, Radar, SlidersHorizontal,
  Sparkles, Store, Trophy, X, SearchX, FilterX,
} from 'lucide-react';
import { api, brl, isUrl, lerPreco, paraCampo } from '@/lib/cliente';
import type { Interpretacao, Loja, Oferta, Produto, Resultado } from '@/lib/types';
import { useApp, type Busca } from './AppState';
import { CampoPreco, DialogoPreco, Imagem, LojaTag, Vazio } from './ui';

const EXEMPLOS = [
  'monitor 280Hz 25 polegadas até R$ 1.500',
  'SSD NVMe 1TB',
  'fone bluetooth com cancelamento de ruído até 500 reais',
  'placa de vídeo RTX 4060',
];

type Ordem = 'relevancia' | 'menor' | 'maior' | 'recentes' | 'loja' | 'nome';
const ORDENS: { v: Ordem; t: string }[] = [
  { v: 'relevancia', t: 'Mais relevantes' },
  { v: 'menor', t: 'Menor preço' },
  { v: 'maior', t: 'Maior preço' },
  { v: 'recentes', t: 'Anúncios mais recentes' },
  { v: 'loja', t: 'Loja' },
  { v: 'nome', t: 'Nome (A–Z)' },
];

/** Cria um alerta e devolve o resultado (usado pela busca e pelos cards). */
function useCriarAlerta() {
  const { setProdutos, toast, erro, email } = useApp();
  return async (body: Record<string, unknown>) => {
    try {
      const d = await api<{ message: string; produto: Produto; resultado: Resultado }>('/api/produtos', { method: 'POST', body });
      setProdutos((p) => [...p, d.produto]);
      const r = d.resultado;
      if (r.status === 'alerta_enviado') toast(`Já está no seu preço! Enviamos um email: ${brl(r.preco_atual)}`);
      else if (r.status === 'abaixo_do_alvo') toast(`Já está no seu preço: ${brl(r.preco_atual)}.`);
      else toast(d.message);
      if (!email) setTimeout(() => toast('Configure seu email (no topo) para receber os avisos', 'info'), 700);
      return true;
    } catch (e) {
      erro(e);
      return false;
    }
  };
}

export function BuscarPage() {
  const { busca, setBusca, lojasBusca, lojas, erro, produtos } = useApp();
  const [texto, setTexto] = useState('');
  const [linkPendente, setLinkPendente] = useState<string | null>(null);
  const criarAlerta = useCriarAlerta();
  const area = useRef<HTMLTextAreaElement>(null);
  const resultadosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [texto]);

  const atualizar = (id: number, fn: (b: Busca) => Busca) => setBusca((b) => (b && b.id === id ? fn(b) : b));

  async function buscar(pedido: string) {
    const id = Date.now();
    const passos: Busca['passos'] = { ia: { status: 'running' } };
    lojasBusca.forEach((l) => (passos[l] = { status: 'idle' }));
    passos.filtro = { status: 'idle' };
    setBusca(() => ({ id, texto: pedido, interp: null, passos, ofertas: [], compativeis: [], terminou: false }));
    setTimeout(() => resultadosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

    try {
      const { interpretacao } = await api<{ interpretacao: Interpretacao }>('/api/interpretar', { method: 'POST', body: { texto: pedido } });
      atualizar(id, (b) => ({ ...b, interp: interpretacao, passos: { ...b.passos, ia: { status: 'done' } } }));

      const todas: Oferta[] = [];
      await Promise.all(lojasBusca.map(async (loja) => {
        atualizar(id, (b) => ({ ...b, passos: { ...b.passos, [loja]: { status: 'running' } } }));
        try {
          const r = await api<{ ofertas: Oferta[]; erro: string | null }>('/api/buscar', { method: 'POST', body: { termo: interpretacao.termo_busca, loja } });
          todas.push(...r.ofertas);
          const status = r.erro || !r.ofertas.length ? 'fail' : 'done';
          atualizar(id, (b) => ({ ...b, passos: { ...b.passos, [loja]: { status, info: r.erro ?? String(r.ofertas.length) } } }));
        } catch (e) {
          atualizar(id, (b) => ({ ...b, passos: { ...b.passos, [loja]: { status: 'fail', info: (e as Error).message } } }));
        }
      }));

      if (!todas.length) {
        atualizar(id, (b) => ({ ...b, terminou: true, passos: { ...b.passos, filtro: { status: 'fail' } } }));
        return;
      }
      atualizar(id, (b) => ({ ...b, passos: { ...b.passos, filtro: { status: 'running' } } }));
      const f = await api<{ ofertas: Oferta[]; todas: Oferta[]; total: number }>('/api/filtrar', {
        method: 'POST', body: { texto: pedido, interpretacao, ofertas: todas },
      });
      atualizar(id, (b) => ({
        ...b, ofertas: f.todas, compativeis: f.ofertas, terminou: true,
        passos: { ...b.passos, filtro: { status: 'done', info: `${f.ofertas.length} de ${f.total}` } },
      }));
    } catch (e) {
      erro(e);
      atualizar(id, (b) => ({ ...b, terminou: true, erro: (e as Error).message }));
    }
  }

  const enviar = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = texto.trim();
    if (t.length < 3) return area.current?.focus();
    if (isUrl(t)) setLinkPendente(t);
    else buscar(t);
  };

  const rodando = !!busca && !busca.terminou;

  return (
    <>
      <section className={`hero ${busca ? 'compact' : ''}`}>
        <div className="hero-glow" aria-hidden />
        <div className="wrap hero-inner">
          {!busca && (
            <>
              <span className="eyebrow"><Sparkles size={15} /> Busca inteligente · 100% gratuito</span>
              <h1>Diga o que você quer.<br /><span className="grad">A gente acha e vigia o preço.</span></h1>
              <p className="lead">Procuramos na KaBuM!, Mercado Livre, Amazon e Magalu, mostramos só o que combina com o seu pedido e avisamos por email quando o preço cair.</p>
            </>
          )}
          <form className="composer" onSubmit={enviar}>
            <Sparkles className="composer-icon" size={19} />
            <textarea
              ref={area} rows={1} maxLength={500} value={texto}
              placeholder="Ex.: quero um monitor de 280Hz de 25 polegadas até R$ 1.500"
              aria-label="O que você procura?"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) enviar(e); }}
            />
            <button className="btn btn-primary btn-lg" type="submit" disabled={rodando}>
              {rodando ? <LoaderCircle className="spin" size={18} /> : <>Buscar <ArrowRight size={18} /></>}
            </button>
          </form>
          {!busca && (
            <>
              <div className="examples">
                <span className="examples-label">Experimente:</span>
                {EXEMPLOS.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => { setTexto(ex); buscar(ex); }}>{ex}</button>
                ))}
              </div>
              <p className="hint"><Link2 size={14} /> Também pode colar o link de um produto específico.</p>
            </>
          )}
        </div>
      </section>

      <div ref={resultadosRef} className="scroll-anchor" />
      {busca && <Resultados busca={busca} lojas={lojas} aoFechar={() => setBusca(() => null)} criarAlerta={criarAlerta} />}
      {!busca && produtos.length > 0 && (
        <section className="wrap teaser">
          <Link href="/alertas" className="teaser-card">
            <Bell size={20} />
            <div><strong>Você tem {produtos.length} {produtos.length === 1 ? 'alerta' : 'alertas'}</strong><span>Ver preços, histórico e ofertas</span></div>
            <ArrowRight size={18} />
          </Link>
        </section>
      )}

      {linkPendente && (
        <DialogoPreco
          aberto titulo="Vigiar produto pelo link" sugestao={null}
          descricao={<>Vou ler o preço desta página e avisar quando baixar:<br /><span className="muted break">{linkPendente}</span></>}
          aoFechar={() => setLinkPendente(null)}
          aoConfirmar={async (preco) => {
            const url = linkPendente;
            setLinkPendente(null);
            if (await criarAlerta({ url, preco_desejado: preco })) setTexto('');
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function Resultados({ busca, lojas, aoFechar, criarAlerta }: {
  busca: Busca; lojas: Record<Loja, string>; aoFechar: () => void; criarAlerta: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [ordem, setOrdem] = useState<Ordem>('relevancia');
  const [lojasOff, setLojasOff] = useState<Set<Loja>>(new Set());
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [ateAlvo, setAteAlvo] = useState(false);
  const [todas, setTodas] = useState(false);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [vigiar, setVigiar] = useState<Oferta | null>(null);
  const [alvoBusca, setAlvoBusca] = useState('');

  const { interp, compativeis, ofertas } = busca;
  const precoMax = interp?.preco_maximo ?? null;

  // Reinicia filtros a cada nova busca e sugere o preço alvo
  useEffect(() => {
    setOrdem('relevancia'); setLojasOff(new Set()); setMin(''); setMax(''); setAteAlvo(false); setTodas(false);
  }, [busca.id]);
  const menorCompat = compativeis.length ? Math.min(...compativeis.map((o) => o.preco)) : null;
  useEffect(() => {
    if (busca.terminou) setAlvoBusca(paraCampo(precoMax ?? (menorCompat ? Math.floor(menorCompat * 0.95) : null)));
  }, [busca.terminou, busca.id, precoMax, menorCompat]);

  const base = todas ? ofertas : compativeis;
  const compatUrls = useMemo(() => new Set(compativeis.map((o) => o.url)), [compativeis]);
  const contagemLoja = useMemo(() => {
    const c: Partial<Record<Loja, number>> = {};
    base.forEach((o) => (c[o.loja] = (c[o.loja] ?? 0) + 1));
    return c;
  }, [base]);

  const lista = useMemo(() => {
    const pMin = lerPreco(min), pMax = lerPreco(max);
    const l = base.filter((o) =>
      !lojasOff.has(o.loja) && (pMin == null || o.preco >= pMin) && (pMax == null || o.preco <= pMax) && (!ateAlvo || precoMax == null || o.preco <= precoMax));
    const rel = (o: Oferta) => (compatUrls.has(o.url) ? 1000 : 0) + (o.pontos ?? 0) * 10 - (o.posicao ?? 50) * 0.1;
    const cmp: Record<Ordem, (a: Oferta, b: Oferta) => number> = {
      relevancia: (a, b) => rel(b) - rel(a) || a.preco - b.preco,
      menor: (a, b) => a.preco - b.preco,
      maior: (a, b) => b.preco - a.preco,
      recentes: (a, b) => (b.recencia ?? -1) - (a.recencia ?? -1) || (a.posicao ?? 0) - (b.posicao ?? 0),
      loja: (a, b) => a.loja.localeCompare(b.loja) || a.preco - b.preco,
      nome: (a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'),
    };
    return [...l].sort(cmp[ordem]);
  }, [base, lojasOff, min, max, ateAlvo, precoMax, ordem, compatUrls]);

  const menor = lista.length ? Math.min(...lista.map((o) => o.preco)) : null;
  const filtrosAtivos = lojasOff.size + (min ? 1 : 0) + (max ? 1 : 0) + (ateAlvo ? 1 : 0) + (todas ? 1 : 0);
  const limpar = () => { setLojasOff(new Set()); setMin(''); setMax(''); setAteAlvo(false); setTodas(false); };

  const passosLista: { k: string; nome: string }[] = [
    { k: 'ia', nome: 'Entendendo o pedido' },
    ...Object.keys(busca.passos).filter((k) => k !== 'ia' && k !== 'filtro').map((k) => ({ k, nome: lojas[k as Loja] ?? k })),
    { k: 'filtro', nome: 'Escolhendo o que combina' },
  ];

  return (
    <section className="wrap results" aria-live="polite">
      <div className="results-head">
        <div>
          <h2>{interp?.resumo ?? `“${busca.texto}”`}</h2>
          {interp && (
            <div className="tags">
              <span className="tag">{interp.termo_busca}</span>
              {interp.requisitos.map((r) => <span key={r} className="tag neutral">{r}</span>)}
              {precoMax && <span className="tag ok">até {brl(precoMax)}</span>}
            </div>
          )}
        </div>
        <button className="btn btn-ghost" type="button" onClick={aoFechar}><X size={16} /> Nova busca</button>
      </div>

      <ol className="steps">
        {passosLista.map(({ k, nome }) => {
          const p = busca.passos[k] ?? { status: 'idle' };
          const I = { idle: CircleDashed, running: LoaderCircle, done: Check, fail: X }[p.status];
          return (
            <li key={k} className={`step ${p.status}`}>
              <I size={15} className={p.status === 'running' ? 'spin' : ''} /> {nome}
              {p.info && <small>{p.info}</small>}
            </li>
          );
        })}
      </ol>

      {busca.terminou && compativeis.length > 0 && (
        <form className="watch-card" onSubmit={async (e) => {
          e.preventDefault();
          const preco = lerPreco(alvoBusca);
          if (!preco) return;
          await criarAlerta({ tipo: 'busca', texto: busca.texto, interpretacao: interp, ofertas: compativeis, preco_desejado: preco });
        }}>
          <div className="watch-icon"><Radar size={22} /></div>
          <div className="watch-text">
            <strong>Vigiar esta busca</strong>
            <span>Hoje o mais barato compatível sai por {brl(menorCompat)}. Aviso quando qualquer um, em qualquer loja, ficar abaixo do seu preço.</span>
          </div>
          <div className="watch-form">
            <CampoPreco valor={alvoBusca} aoMudar={setAlvoBusca} placeholder="Preço alvo" />
            <button className="btn btn-primary" type="submit"><Bell size={16} /> Criar alerta</button>
          </div>
        </form>
      )}

      {!busca.terminou && <div className="grid offers">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" />)}</div>}

      {busca.terminou && !ofertas.length && (
        <Vazio icone={<Store />} titulo={busca.erro ? 'Não deu certo' : 'Nenhuma loja retornou resultados'}>
          {busca.erro ?? 'As lojas podem estar bloqueando consultas automáticas agora. Tente de novo em alguns minutos ou com outras palavras.'}
        </Vazio>
      )}

      {busca.terminou && ofertas.length > 0 && (
        <div className="results-layout">
          <aside className={`filters ${filtrosAbertos ? 'open' : ''}`}>
            <div className="filters-head">
              <strong><SlidersHorizontal size={16} /> Filtros</strong>
              {filtrosAtivos > 0 && <button type="button" className="link-btn" onClick={limpar}>Limpar</button>}
            </div>

            <div className="filter-group">
              <span className="filter-title">Lojas</span>
              {(Object.keys(lojas) as Loja[]).filter((l) => contagemLoja[l]).map((l) => (
                <label key={l} className="check">
                  <input type="checkbox" checked={!lojasOff.has(l)} onChange={() => setLojasOff((s) => {
                    const n = new Set(s);
                    if (n.has(l)) n.delete(l); else n.add(l);
                    return n;
                  })} />
                  <span className={`store store-${l}`}>{lojas[l]}</span>
                  <span className="muted">{contagemLoja[l]}</span>
                </label>
              ))}
            </div>

            <div className="filter-group">
              <span className="filter-title">Faixa de preço</span>
              <div className="range">
                <CampoPreco valor={min} aoMudar={setMin} placeholder="mín." />
                <CampoPreco valor={max} aoMudar={setMax} placeholder="máx." />
              </div>
              {precoMax != null && (
                <label className="check">
                  <input type="checkbox" checked={ateAlvo} onChange={(e) => setAteAlvo(e.target.checked)} />
                  Só até {brl(precoMax)}
                </label>
              )}
            </div>

            <div className="filter-group">
              <span className="filter-title">Compatibilidade</span>
              <label className="check">
                <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} />
                Mostrar também os que não batem com o pedido ({ofertas.length - compativeis.length})
              </label>
            </div>
          </aside>

          <div className="results-main">
            <div className="toolbar">
              <span className="muted">
                {lista.length} {lista.length === 1 ? 'resultado' : 'resultados'}
                {!todas && ` compatíve${lista.length === 1 ? 'l' : 'is'}`}
              </span>
              <div className="toolbar-right">
                <button type="button" className="btn btn-secondary btn-sm show-md" onClick={() => setFiltrosAbertos((v) => !v)}>
                  <SlidersHorizontal size={15} /> Filtros{filtrosAtivos ? ` (${filtrosAtivos})` : ''}
                </button>
                <label className="select">
                  <span className="hide-xs">Ordenar:</span>
                  <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
                    {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {ordem === 'recentes' && (
              <p className="hint-line">As lojas não informam a data do anúncio; estimamos pelo número do anúncio (KaBuM! e Mercado Livre). Amazon e Magalu ficam por último.</p>
            )}

            {lista.length === 0 ? (
              compativeis.length === 0 && !todas ? (
                <Vazio icone={<FilterX />} titulo="Nada bateu exatamente com o pedido">
                  Encontrei {ofertas.length} anúncios, mas nenhum cumpre tudo o que você pediu.
                  <div><button type="button" className="btn btn-secondary" onClick={() => setTodas(true)}>Ver todos os resultados</button></div>
                </Vazio>
              ) : (
                <Vazio icone={<SearchX />} titulo="Nenhum resultado com esses filtros">
                  <button type="button" className="btn btn-secondary" onClick={limpar}>Limpar filtros</button>
                </Vazio>
              )
            ) : (
              <div className="grid offers">
                {lista.map((o, i) => (
                  <CardOferta key={o.url} o={o} i={i} melhor={o.preco === menor} compativel={compatUrls.has(o.url)} aoVigiar={() => setVigiar(o)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {vigiar && (
        <DialogoPreco
          aberto titulo="Vigiar este produto"
          sugestao={precoMax && precoMax < vigiar.preco ? precoMax : Math.floor(vigiar.preco * 0.9)}
          descricao={<><strong>{vigiar.titulo}</strong><br />Hoje: {brl(vigiar.preco)} na {lojas[vigiar.loja]}.</>}
          aoFechar={() => setVigiar(null)}
          aoConfirmar={(preco) => {
            const o = vigiar;
            setVigiar(null);
            criarAlerta({ url: o.url, nome: o.titulo, imagem: o.imagem, preco_atual: o.preco, preco_desejado: preco });
          }}
        />
      )}
    </section>
  );
}

function CardOferta({ o, i, melhor, compativel, aoVigiar }: { o: Oferta; i: number; melhor: boolean; compativel: boolean; aoVigiar: () => void }) {
  return (
    <article className={`card offer ${compativel ? '' : 'dim'}`} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
      <div className="badges">
        {melhor && <span className="badge badge-best"><Trophy size={12} /> Menor preço</span>}
        {o.recencia != null && o.recencia >= 0.8 && <span className="badge badge-new"><Sparkles size={12} /> Anúncio novo</span>}
      </div>
      <div className="offer-img"><Imagem src={o.imagem} tamanho="lg" /></div>
      <div className="offer-body">
        <LojaTag loja={o.loja} />
        <div className="offer-title" title={o.titulo}>{o.titulo}</div>
        {compativel && o.motivo
          ? <div className="offer-why"><Check size={13} /> <span>{o.motivo}</span></div>
          : !compativel && <div className="offer-why off"><X size={13} /> <span>Não confirmei que bate com o pedido</span></div>}
        <div className="offer-price">{brl(o.preco)}</div>
        <div className="offer-foot">
          <button className="btn btn-primary btn-sm" type="button" onClick={aoVigiar}><Bell size={14} /> Vigiar</button>
          <a className="btn btn-secondary btn-sm" href={o.url} target="_blank" rel="noopener noreferrer">Ver <ExternalLink size={13} /></a>
        </div>
      </div>
    </article>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell, BellRing, CircleAlert, ExternalLink, Eye, Hourglass, LineChart, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, Trophy,
} from 'lucide-react';
import { api, brl, lerPreco, paraCampo, tempoRelativo } from '@/lib/cliente';
import type { Produto, Resultado } from '@/lib/types';
import { useApp } from './AppState';
import { Modal } from './Modal';
import { CampoPreco, Grafico, Imagem, LojaTag, Sparkline, Vazio } from './ui';

type Filtro = 'todos' | 'alvo' | 'busca' | 'link';
type Ordem = 'perto' | 'menor' | 'maior' | 'queda' | 'novidades' | 'recentes' | 'verificados' | 'nome';
const ORDENS: { v: Ordem; t: string }[] = [
  { v: 'perto', t: 'Mais perto do alvo' },
  { v: 'menor', t: 'Menor preço' },
  { v: 'maior', t: 'Maior preço' },
  { v: 'queda', t: 'Maior queda de preço' },
  { v: 'novidades', t: 'Com ofertas novas' },
  { v: 'recentes', t: 'Criados recentemente' },
  { v: 'verificados', t: 'Verificados recentemente' },
  { v: 'nome', t: 'Nome (A–Z)' },
];

const noAlvo = (p: Produto) => p.preco_atual != null && p.preco_atual <= p.preco_desejado;
const queda = (p: Produto) => (p.preco_inicial && p.preco_atual != null ? (p.preco_inicial - p.preco_atual) / p.preco_inicial : 0);

export function AlertasPage() {
  const { produtos, setProdutos, carregado, toast, erro } = useApp();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [ordem, setOrdem] = useState<Ordem>('perto');
  const [termo, setTermo] = useState('');
  const [verificandoTudo, setVerificandoTudo] = useState(false);
  const [detalhe, setDetalhe] = useState<Produto | null>(null);
  const [editar, setEditar] = useState<Produto | null>(null);
  const [remover, setRemover] = useState<Produto | null>(null);
  const [, forcar] = useState(0);

  useEffect(() => {
    const t = setInterval(() => forcar((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const lista = useMemo(() => {
    const t = termo.trim().toLowerCase();
    let l = produtos.filter((p) => p.nome.toLowerCase().includes(t) || (p.melhor_oferta?.titulo ?? '').toLowerCase().includes(t));
    if (filtro === 'alvo') l = l.filter(noAlvo);
    else if (filtro !== 'todos') l = l.filter((p) => p.tipo === filtro);
    const ratio = (p: Produto) => (p.preco_atual ? p.preco_atual / p.preco_desejado : Infinity);
    const cmp: Record<Ordem, (a: Produto, b: Produto) => number> = {
      perto: (a, b) => ratio(a) - ratio(b),
      menor: (a, b) => (a.preco_atual ?? Infinity) - (b.preco_atual ?? Infinity),
      maior: (a, b) => (b.preco_atual ?? -1) - (a.preco_atual ?? -1),
      queda: (a, b) => queda(b) - queda(a),
      novidades: (a, b) => (b.novidades ?? 0) - (a.novidades ?? 0) || ratio(a) - ratio(b),
      recentes: (a, b) => b.criado_em.localeCompare(a.criado_em),
      verificados: (a, b) => (b.ultima_verificacao ?? '').localeCompare(a.ultima_verificacao ?? ''),
      nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'),
    };
    return [...l].sort(cmp[ordem]);
  }, [produtos, filtro, ordem, termo]);

  const substituir = (p: Produto) => setProdutos((l) => l.map((x) => (x.id === p.id ? p : x)));

  const verificarTudo = async () => {
    setVerificandoTudo(true);
    try {
      const d = await api<{ resultados: Resultado[]; produtos: Produto[] }>('/api/verificar', { method: 'POST' });
      setProdutos(() => d.produtos);
      const conta = (s: string) => d.resultados.filter((r) => r.status === s).length;
      const alvo = conta('alerta_enviado') + conta('abaixo_do_alvo');
      const erros = conta('erro');
      toast(`${d.resultados.length} verificados · ${alvo} no alvo${erros ? ` · ${erros} sem resposta` : ''}`, alvo ? 'ok' : 'info');
    } catch (e) { erro(e); } finally { setVerificandoTudo(false); }
  };

  const comPreco = produtos.filter((p) => p.preco_atual != null);
  const falta = comPreco.reduce((s, p) => s + Math.max(0, p.preco_atual! - p.preco_desejado), 0);
  const economia = comPreco.reduce((s, p) => s + Math.max(0, (p.preco_inicial ?? p.preco_atual!) - p.preco_atual!), 0);
  const ultima = produtos.map((p) => p.ultima_verificacao).filter(Boolean).sort().pop();
  const contagem = { todos: produtos.length, alvo: produtos.filter(noAlvo).length, busca: produtos.filter((p) => p.tipo === 'busca').length, link: produtos.filter((p) => p.tipo === 'link').length };

  return (
    <section className="wrap dashboard">
      <div className="section-head">
        <div>
          <h1 className="page-title">Meus alertas</h1>
          <p className="muted">Verificados automaticamente todo dia{ultima ? ` · última verificação ${tempoRelativo(ultima)}` : ''}. Você recebe um email quando algum chegar no seu preço.</p>
        </div>
        <div className="head-actions">
          <Link href="/buscar" className="btn btn-secondary"><Plus size={16} /> Novo alerta</Link>
          <button className="btn btn-primary" type="button" onClick={verificarTudo} disabled={verificandoTudo || !produtos.length}>
            <RefreshCw size={16} className={verificandoTudo ? 'spin' : ''} /> {verificandoTudo ? 'Verificando…' : 'Verificar agora'}
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><span className="stat-label">Alertas ativos</span><span className="stat-value">{produtos.length}</span></div>
        <div className="stat stat-ok"><span className="stat-label">No preço que você quer</span><span className="stat-value">{contagem.alvo}</span></div>
        <div className="stat"><span className="stat-label">Já caiu desde que você começou</span><span className="stat-value">{comPreco.length ? brl(economia) : '—'}</span></div>
        <div className="stat"><span className="stat-label">Falta para os alvos</span><span className="stat-value">{comPreco.length ? brl(falta) : '—'}</span></div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist">
          {(['todos', 'alvo', 'busca', 'link'] as Filtro[]).map((f) => (
            <button key={f} type="button" className={filtro === f ? 'active' : ''} onClick={() => setFiltro(f)}>
              {{ todos: 'Todos', alvo: 'No alvo', busca: 'Buscas', link: 'Produtos' }[f]} <span className="seg-count">{contagem[f]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="search-input">
            <Search size={15} />
            <input type="search" placeholder="Filtrar…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Filtrar alertas" />
          </label>
          <label className="select">
            <span className="hide-xs">Ordenar:</span>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}>
              {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </label>
        </div>
      </div>

      {!carregado ? (
        <div className="grid items">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 240 }} />)}</div>
      ) : !produtos.length ? (
        <Vazio icone={<Bell />} titulo="Nenhum alerta ainda">
          Busque o que você quer comprar e clique em <strong>Vigiar</strong>, ou crie um alerta para a busca inteira.
          <div><Link href="/buscar" className="btn btn-primary"><Search size={16} /> Começar uma busca</Link></div>
        </Vazio>
      ) : !lista.length ? (
        <Vazio icone={<Search />} titulo="Nada aqui">Nenhum alerta neste filtro.</Vazio>
      ) : (
        <div className="grid items">
          {lista.map((p) => (
            <CardAlerta key={p.id} p={p} aoAtualizar={substituir} aoDetalhar={() => setDetalhe(p)} aoEditar={() => setEditar(p)} aoRemover={() => setRemover(p)} />
          ))}
        </div>
      )}

      {detalhe && <Detalhes p={produtos.find((x) => x.id === detalhe.id) ?? detalhe} aoFechar={() => setDetalhe(null)} />}
      {editar && <Editar p={editar} aoFechar={() => setEditar(null)} aoSalvar={substituir} />}
      {remover && (
        <Modal aberto titulo="Remover alerta?" aoFechar={() => setRemover(null)}
          aoEnviar={async () => {
            const p = remover;
            setRemover(null);
            try {
              await api(`/api/produtos/${p.id}`, { method: 'DELETE' });
              setProdutos((l) => l.filter((x) => x.id !== p.id));
              toast('Alerta removido');
            } catch (e) { erro(e); }
          }}
          rodape={<>
            <button type="button" className="btn btn-ghost" onClick={() => setRemover(null)}>Cancelar</button>
            <button type="submit" className="btn btn-danger">Remover</button>
          </>}>
          <p className="dialog-note">{remover.nome}</p>
        </Modal>
      )}
    </section>
  );
}

function status(p: Produto) {
  if (p.preco_atual == null) return p.erro ? { cls: 'bad', I: CircleAlert, txt: 'Sem preço agora' } : { cls: 'new', I: Hourglass, txt: 'Aguardando' };
  if (noAlvo(p)) return { cls: 'ok', I: BellRing, txt: p.alertado ? 'Email enviado' : 'No preço alvo!' };
  return { cls: 'wait', I: Eye, txt: 'Vigiando' };
}

function CardAlerta({ p, aoAtualizar, aoDetalhar, aoEditar, aoRemover }: {
  p: Produto; aoAtualizar: (p: Produto) => void; aoDetalhar: () => void; aoEditar: () => void; aoRemover: () => void;
}) {
  const { toast, erro } = useApp();
  const [girando, setGirando] = useState(false);
  const st = status(p);
  const hit = noAlvo(p);
  const pct = p.preco_atual ? Math.min(100, (p.preco_desejado / p.preco_atual) * 100) : 0;
  const falta = p.preco_atual != null ? p.preco_atual - p.preco_desejado : null;
  const q = queda(p);

  const verificar = async () => {
    setGirando(true);
    try {
      const d = await api<{ resultado: Resultado; produto: Produto }>(`/api/produtos/${p.id}/verificar`, { method: 'POST' });
      aoAtualizar(d.produto);
      const r = d.resultado;
      toast(r.status === 'erro' ? r.mensagem ?? 'Erro' : `Agora: ${brl(r.preco_atual)}`, r.status === 'erro' ? 'err' : 'ok');
    } catch (e) { erro(e); } finally { setGirando(false); }
  };

  return (
    <article className={`card item ${hit ? 'hit' : ''}`}>
      <div className="item-top">
        <Imagem src={p.imagem} busca={p.tipo === 'busca'} />
        <div className="min0">
          <div className="item-title" title={p.nome}>{p.nome}</div>
          <div className="item-meta">
            <span className={`kind ${p.tipo}`}>{p.tipo === 'busca' ? 'Busca' : 'Produto'}</span>
            <LojaTag loja={p.loja} />
            <span>{tempoRelativo(p.ultima_verificacao)}</span>
            {!!p.novidades && <span className="kind novo"><Sparkles size={11} /> {p.novidades} {p.novidades === 1 ? 'nova' : 'novas'}</span>}
          </div>
        </div>
      </div>
      {p.tipo === 'busca' && p.melhor_oferta && (
        <div className="item-best"><Trophy size={14} /><span title={p.melhor_oferta.titulo}>{p.melhor_oferta.titulo}</span></div>
      )}
      <div className="item-prices">
        <div>
          <div className={`price-now ${hit ? 'hit' : ''}`}>
            {brl(p.preco_atual)}
            {q > 0.005 && <span className="drop">−{Math.round(q * 100)}%</span>}
          </div>
          <div className="price-sub">
            Alvo <strong>{brl(p.preco_desejado)}</strong>
            {falta != null && falta > 0 && <> · faltam {brl(falta)}</>}
            {p.preco_minimo != null && <> · menor {brl(p.preco_minimo)}</>}
          </div>
        </div>
        <Sparkline historico={p.historico} alvo={p.preco_desejado} />
      </div>
      {p.preco_atual != null && <div className={`meter ${hit ? 'hit' : ''}`}><span style={{ width: `${pct.toFixed(0)}%` }} /></div>}
      {p.erro && <div className="item-error"><CircleAlert size={14} /><span>{p.erro}</span></div>}
      <div className="item-foot">
        <span className={`pill ${st.cls}`}><st.I size={13} /> {st.txt}</span>
        <div className="actions">
          {p.url && <a className="icon-btn" href={p.url} target="_blank" rel="noopener noreferrer" title="Abrir na loja"><ExternalLink size={16} /></a>}
          <button className="icon-btn" type="button" onClick={verificar} disabled={girando} title="Verificar agora"><RefreshCw size={16} className={girando ? 'spin' : ''} /></button>
          <button className="icon-btn" type="button" onClick={aoDetalhar} title="Histórico e ofertas"><LineChart size={16} /></button>
          <button className="icon-btn" type="button" onClick={aoEditar} title="Editar"><Pencil size={16} /></button>
          <button className="icon-btn danger" type="button" onClick={aoRemover} title="Remover"><Trash2 size={16} /></button>
        </div>
      </div>
    </article>
  );
}

function Detalhes({ p, aoFechar }: { p: Produto; aoFechar: () => void }) {
  const [ordem, setOrdem] = useState<'menor' | 'maior' | 'novas' | 'loja'>('menor');
  const precos = p.historico.map((h) => h.p);
  const ofertas = useMemo(() => {
    const l = [...(p.ofertas ?? [])];
    if (ordem === 'maior') l.sort((a, b) => b.preco - a.preco);
    else if (ordem === 'novas') l.sort((a, b) => (b.visto_em ?? '').localeCompare(a.visto_em ?? '') || a.preco - b.preco);
    else if (ordem === 'loja') l.sort((a, b) => a.loja.localeCompare(b.loja) || a.preco - b.preco);
    else l.sort((a, b) => a.preco - b.preco);
    return l;
  }, [p.ofertas, ordem]);

  return (
    <Modal aberto largo titulo={p.nome} aoFechar={aoFechar}>
      <div className="mini-stats">
        <div><span>Agora</span><strong>{brl(p.preco_atual)}</strong></div>
        <div><span>Menor</span><strong className="txt-ok">{brl(precos.length ? Math.min(...precos) : null)}</strong></div>
        <div><span>Maior</span><strong>{brl(precos.length ? Math.max(...precos) : null)}</strong></div>
        <div><span>Seu alvo</span><strong>{brl(p.preco_desejado)}</strong></div>
      </div>
      {p.historico.length ? <Grafico historico={p.historico} alvo={p.preco_desejado} /> : (
        <Vazio icone={<LineChart />} titulo="Sem histórico ainda">Os preços aparecem aqui a cada verificação.</Vazio>
      )}
      {ofertas.length > 0 && (
        <>
          <div className="toolbar compact">
            <h4>Ofertas compatíveis</h4>
            <label className="select">
              <select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)}>
                <option value="menor">Menor preço</option>
                <option value="maior">Maior preço</option>
                <option value="novas">Vistas mais recentemente</option>
                <option value="loja">Loja</option>
              </select>
            </label>
          </div>
          <div className="offer-list">
            {ofertas.map((o) => (
              <a key={o.url} className="offer-row" href={o.url} target="_blank" rel="noopener noreferrer">
                <Imagem src={o.imagem} tamanho="sm" />
                <div className="min0">
                  <div className="t" title={o.titulo}>{o.titulo}</div>
                  <div className="row-meta"><LojaTag loja={o.loja} />{o.novo && <span className="kind novo"><Sparkles size={11} /> nova</span>}{o.visto_em && <span className="muted">vista {tempoRelativo(o.visto_em)}</span>}</div>
                </div>
                <span className="p">{brl(o.preco)}</span>
              </a>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function Editar({ p, aoFechar, aoSalvar }: { p: Produto; aoFechar: () => void; aoSalvar: (p: Produto) => void }) {
  const { toast, erro } = useApp();
  const [nome, setNome] = useState(p.nome);
  const [preco, setPreco] = useState(paraCampo(p.preco_desejado));
  const [aviso, setAviso] = useState('');
  return (
    <Modal aberto titulo="Editar alerta" aoFechar={aoFechar}
      aoEnviar={async () => {
        const valor = lerPreco(preco);
        if (!nome.trim()) return setAviso('Informe um nome');
        if (!valor) return setAviso('Informe um preço válido');
        try {
          const d = await api<{ produto: Produto }>(`/api/produtos/${p.id}`, { method: 'PATCH', body: { nome: nome.trim(), preco_desejado: valor } });
          aoSalvar(d.produto);
          toast('Alerta atualizado');
          aoFechar();
        } catch (e) { erro(e); }
      }}
      rodape={<>
        <button type="button" className="btn btn-ghost" onClick={aoFechar}>Cancelar</button>
        <button type="submit" className="btn btn-primary">Salvar</button>
      </>}>
      <div className="field">
        <label htmlFor="edNome">Nome</label>
        <input className="input" id="edNome" maxLength={200} value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="edPreco">Preço alvo</label>
        <CampoPreco id="edPreco" valor={preco} aoMudar={setPreco} />
      </div>
      {aviso && <div className="notice">{aviso}</div>}
    </Modal>
  );
}

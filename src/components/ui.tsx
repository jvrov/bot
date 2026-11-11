'use client';

import { useState } from 'react';
import { Bell, Box, ImageOff, Radar } from 'lucide-react';
import { brl, lerPreco, paraCampo } from '@/lib/cliente';
import type { Loja, PontoHistorico } from '@/lib/types';
import { useApp } from './AppState';
import { Modal } from './Modal';

export function LojaTag({ loja }: { loja: Loja | null | undefined }) {
  const { lojas } = useApp();
  if (!loja) return null;
  return <span className={`store store-${loja}`}>{lojas[loja] ?? loja}</span>;
}

export function Imagem({ src, tamanho = 'md', busca = false }: { src: string | null | undefined; tamanho?: 'sm' | 'md' | 'lg'; busca?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (busca && !src) return <div className={`thumb thumb-${tamanho} search`}><Radar /></div>;
  return (
    <div className={`thumb thumb-${tamanho}`}>
      {src && !falhou
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} />
        : tamanho === 'lg' ? <ImageOff className="ph" /> : <Box className="ph" />}
    </div>
  );
}

export function Sparkline({ historico, alvo }: { historico: PontoHistorico[]; alvo: number }) {
  const pts = historico.map((h) => h.p);
  if (pts.length < 2) return null;
  const w = 120, h = 40, pad = 3;
  const min = Math.min(...pts, alvo), max = Math.max(...pts, alvo), span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (pts.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - pad * 2)) / span;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path className="area" d={`${d} L${x(pts.length - 1)},${h} L${x(0)},${h} Z`} />
      <line className="target" x1={0} x2={w} y1={y(alvo)} y2={y(alvo)} />
      <path d={d} />
    </svg>
  );
}

export function Grafico({ historico, alvo }: { historico: PontoHistorico[]; alvo: number }) {
  const w = 720, h = 240, l = 64, r = 14, t = 14, b = 26;
  const pts = historico.map((p) => p.p);
  let min = Math.min(...pts, alvo), max = Math.max(...pts, alvo);
  const m = (max - min) * 0.12 || max * 0.05;
  min -= m; max += m;
  const x = (i: number) => l + (pts.length === 1 ? (w - l - r) / 2 : (i * (w - l - r)) / (pts.length - 1));
  const y = (v: number) => t + ((max - v) * (h - t - b)) / (max - min);
  const linha = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
  const datas = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Histórico de preços">
      <defs>
        <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" stopOpacity=".25" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="grid">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={l} x2={w - r} y1={y(v)} y2={y(v)} />
            <text x={l - 8} y={y(v) + 4} textAnchor="end">{v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</text>
          </g>
        ))}
      </g>
      <path className="area" d={`${linha} L${x(pts.length - 1)},${h - b} L${x(0)},${h - b} Z`} />
      <line className="target" x1={l} x2={w - r} y1={y(alvo)} y2={y(alvo)} />
      <text x={w - r} y={y(alvo) - 6} textAnchor="end" style={{ fill: 'var(--ok)' }}>seu alvo</text>
      <path className="line" d={linha} />
      {pts.length <= 40 && pts.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={3.5}><title>{`${brl(v)} · ${new Date(historico[i].t).toLocaleString('pt-BR')}`}</title></circle>
      ))}
      {datas.map((i) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}>
          {new Date(historico[i].t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
        </text>
      ))}
    </svg>
  );
}

/** Campo de dinheiro (R$) controlado por texto. */
export function CampoPreco({ valor, aoMudar, id, placeholder, autoFocus }: { valor: string; aoMudar: (v: string) => void; id?: string; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="money-input">
      <span>R$</span>
      <input id={id} inputMode="decimal" value={valor} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

/** Pergunta o preço alvo antes de criar um alerta. */
export function DialogoPreco({ aberto, titulo, descricao, sugestao, aoConfirmar, aoFechar }: {
  aberto: boolean; titulo: string; descricao: React.ReactNode; sugestao: number | null;
  aoConfirmar: (preco: number) => void; aoFechar: () => void;
}) {
  const [valor, setValor] = useState(paraCampo(sugestao));
  const [aviso, setAviso] = useState('');
  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      aoFechar={aoFechar}
      aoEnviar={() => {
        const p = lerPreco(valor);
        if (!p) return setAviso('Informe um preço válido');
        aoConfirmar(p);
      }}
      rodape={<>
        <button type="button" className="btn btn-ghost" onClick={aoFechar}>Cancelar</button>
        <button type="submit" className="btn btn-primary"><Bell size={16} /> Criar alerta</button>
      </>}
    >
      <div className="dialog-note">{descricao}</div>
      <div className="field">
        <label htmlFor="dlgPreco">Me avise quando custar até</label>
        <CampoPreco id="dlgPreco" valor={valor} aoMudar={setValor} autoFocus />
      </div>
      {aviso && <div className="notice">{aviso}</div>}
    </Modal>
  );
}

export function Vazio({ icone, titulo, children }: { icone: React.ReactNode; titulo: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icone}</div>
      <h3>{titulo}</h3>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

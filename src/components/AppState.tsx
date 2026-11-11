'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { api } from '@/lib/cliente';
import type { Interpretacao, Loja, Oferta, Produto } from '@/lib/types';

type TipoToast = 'ok' | 'err' | 'info';
interface Toast { id: number; msg: string; tipo: TipoToast; saindo?: boolean }

export type StatusPasso = 'idle' | 'running' | 'done' | 'fail';
export interface Busca {
  id: number;
  texto: string;
  interp: Interpretacao | null;
  passos: Record<string, { status: StatusPasso; info?: string }>;
  ofertas: Oferta[];      // todas, com recência calculada
  compativeis: Oferta[];  // filtradas pelo pedido
  terminou: boolean;
  erro?: string;
}

interface Estado {
  carregado: boolean;
  uid: string | null;
  email: string | null;
  emailConfigurado: boolean;
  produtos: Produto[];
  lojas: Record<Loja, string>;
  lojasBusca: Loja[];
}

interface Ctx extends Estado {
  setProdutos: (fn: (p: Produto[]) => Produto[]) => void;
  setEmail: (e: string) => void;
  recarregar: () => Promise<void>;
  toast: (msg: string, tipo?: TipoToast) => void;
  erro: (e: unknown) => void;
  busca: Busca | null;
  setBusca: (fn: (b: Busca | null) => Busca | null) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function useApp() {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({
    carregado: false, uid: null, email: null, emailConfigurado: true, produtos: [],
    lojas: {} as Record<Loja, string>, lojasBusca: [],
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busca, setBuscaState] = useState<Busca | null>(null);
  const seq = useRef(0);

  const toast = useCallback((msg: string, tipo: TipoToast = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, tipo }]);
    setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, saindo: true } : x))), tipo === 'err' ? 6000 : 3500);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'err' ? 6300 : 3800);
  }, []);
  const erro = useCallback((e: unknown) => toast(e instanceof Error ? e.message : String(e), 'err'), [toast]);

  const recarregar = useCallback(async () => {
    try {
      const d = await api<{ uid: string; email: string | null; email_configurado: boolean; produtos: Produto[]; lojas: Record<Loja, string>; lojas_busca: Loja[] }>('/api/estado');
      setEstado({ carregado: true, uid: d.uid, email: d.email, emailConfigurado: d.email_configurado, produtos: d.produtos, lojas: d.lojas, lojasBusca: d.lojas_busca });
    } catch (e) {
      setEstado((s) => ({ ...s, carregado: true }));
      erro(e);
    }
  }, [erro]);

  useEffect(() => { recarregar(); }, [recarregar]);

  const value = useMemo<Ctx>(() => ({
    ...estado,
    setProdutos: (fn) => setEstado((s) => ({ ...s, produtos: fn(s.produtos) })),
    setEmail: (email) => setEstado((s) => ({ ...s, email })),
    recarregar, toast, erro,
    busca,
    setBusca: setBuscaState,
  }), [estado, recarregar, toast, erro, busca]);

  const Icone = { ok: CircleCheck, err: CircleAlert, info: Info };
  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => {
          const I = Icone[t.tipo];
          return (
            <div key={t.id} className={`toast ${t.tipo} ${t.saindo ? 'out' : ''}`}>
              <I size={18} />
              <div>{t.msg}</div>
            </div>
          );
        })}
      </div>
    </AppContext.Provider>
  );
}

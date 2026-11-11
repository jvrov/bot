'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, Copy, Mail, Moon, Search, Send, Sun, TrendingDown } from 'lucide-react';
import { api } from '@/lib/cliente';
import { useApp } from './AppState';
import { Modal } from './Modal';

function useTema() {
  const [tema, setTema] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    setTema(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);
  const alternar = () => {
    const novo = tema === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem('theme', novo); } catch { /* modo privado */ }
    setTema(novo);
  };
  return { tema, alternar };
}

export function Header() {
  const path = usePathname();
  const { produtos, email, emailConfigurado } = useApp();
  const { tema, alternar } = useTema();
  const [config, setConfig] = useState(false);
  const noAlvo = produtos.filter((p) => p.preco_atual != null && p.preco_atual <= p.preco_desejado).length;

  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        <Link className="brand" href="/buscar">
          <span className="brand-mark"><TrendingDown size={17} strokeWidth={2.5} /></span>
          <span className="hide-xs">Price Monitor</span>
        </Link>

        <nav className="tabs" aria-label="Seções">
          <Link href="/buscar" className={path?.startsWith('/buscar') ? 'active' : ''}>
            <Search size={16} /> Buscar
          </Link>
          <Link href="/alertas" className={path?.startsWith('/alertas') ? 'active' : ''}>
            <Bell size={16} /> <span>Alertas</span>
            {produtos.length > 0 && <span className={`count-pill ${noAlvo ? 'ok' : ''}`}>{noAlvo || produtos.length}</span>}
          </Link>
        </nav>

        <div className="topbar-actions">
          <button className="btn btn-ghost" type="button" onClick={() => setConfig(true)} title="Configurar email">
            <span className={`status-dot ${email && emailConfigurado ? 'ok' : ''}`} />
            <span className="hide-sm">{email ?? 'Configurar email'}</span>
            <Mail size={17} className="show-sm" />
          </button>
          <button className="icon-btn" type="button" onClick={alternar} aria-label="Alternar tema">
            {tema === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>
      {config && <Configuracoes aoFechar={() => setConfig(false)} />}
    </header>
  );
}

function Configuracoes({ aoFechar }: { aoFechar: () => void }) {
  const { email, setEmail, emailConfigurado, uid, toast, erro, recarregar } = useApp();
  const [valor, setValor] = useState(email ?? '');
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const salvar = async () => {
    setOcupado(true);
    try {
      const d = await api<{ message: string }>('/api/email', { method: 'POST', body: { email: valor.trim() } });
      setEmail(valor.trim());
      toast(d.message);
      aoFechar();
    } catch (e) { erro(e); } finally { setOcupado(false); }
  };
  const testar = async () => {
    try { toast((await api<{ message: string }>('/api/email/teste', { method: 'POST' })).message); } catch (e) { erro(e); }
  };
  const usarCodigo = async () => {
    try {
      const d = await api<{ message: string }>('/api/conta', { method: 'POST', body: { codigo } });
      await recarregar();
      toast(d.message);
      aoFechar();
    } catch (e) { erro(e); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(uid ?? ''); toast('Código copiado'); } catch { toast('Não consegui copiar', 'err'); }
  };

  return (
    <Modal aberto titulo="Configurações" aoFechar={aoFechar} aoEnviar={salvar}
      rodape={<>
        <button type="button" className="btn btn-ghost" onClick={testar} disabled={!email}><Send size={15} /> Email de teste</button>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>Salvar email</button>
      </>}>
      <div className="field">
        <label htmlFor="cfgEmail">Email para os avisos</label>
        <input className="input" id="cfgEmail" type="email" placeholder="voce@exemplo.com" value={valor} onChange={(e) => setValor(e.target.value)} />
        <small>Avisamos quando um alerta chegar no preço que você quer.</small>
      </div>
      {!emailConfigurado && <div className="notice">O servidor ainda não tem um remetente configurado (EMAIL_USER / EMAIL_PASSWORD).</div>}

      <div className="divider" />
      <div className="field">
        <label>Seu código de acesso</label>
        <div className="code-row">
          <code>{uid}</code>
          <button type="button" className="icon-btn" onClick={copiar} aria-label="Copiar código"><Copy size={16} /></button>
        </div>
        <small>Guarde este código. Com ele você abre os mesmos alertas em outro aparelho ou navegador.</small>
      </div>
      <div className="field">
        <label htmlFor="cfgCodigo">Usar código de outro aparelho</label>
        <div className="inline">
          <input className="input" id="cfgCodigo" placeholder="Cole o código aqui" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <button type="button" className="btn btn-secondary" onClick={usarCodigo} disabled={codigo.trim().length !== 32}>Usar</button>
        </div>
      </div>
    </Modal>
  );
}

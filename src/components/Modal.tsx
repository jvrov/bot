'use client';

import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  aberto: boolean;
  titulo: ReactNode;
  aoFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largo?: boolean;
  aoEnviar?: () => void;
}

/** Janela modal acessível usando o elemento nativo <dialog>. */
export function Modal({ aberto, titulo, aoFechar, children, rodape, largo, aoEnviar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    aoEnviar?.();
  };

  return (
    <dialog
      ref={ref}
      className={`dialog ${largo ? 'wide' : ''}`}
      onClose={aoFechar}
      onClick={(e) => { if (e.target === ref.current) aoFechar(); }}
    >
      {aberto && (
        <form className="dialog-inner" onSubmit={enviar}>
          <header className="dialog-head">
            <h3>{titulo}</h3>
            <button type="button" className="icon-btn" onClick={aoFechar} aria-label="Fechar"><X size={18} /></button>
          </header>
          <div className="dialog-body">{children}</div>
          {rodape && <footer className="dialog-foot">{rodape}</footer>}
        </form>
      )}
    </dialog>
  );
}

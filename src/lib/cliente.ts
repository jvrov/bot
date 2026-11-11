/** Utilidades usadas só no navegador. */
export { brl } from './preco';

export class ApiError extends Error {}

export async function api<T = Record<string, unknown>>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', headers: {} };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  let res: Response | undefined;
  let data: { success?: boolean; message?: string } & Record<string, unknown>;
  try {
    res = await fetch(url, init);
    data = await res.json();
  } catch {
    throw new ApiError(res?.status === 504 ? 'O servidor demorou demais para responder' : 'Falha de conexão com o servidor');
  }
  if (!data.success) throw new ApiError(data.message || 'Erro desconhecido');
  return data as T;
}

/** Aceita "1.999,90", "1999.90", "1999". */
export function lerPreco(texto: string): number | null {
  let s = String(texto ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export const paraCampo = (v: number | null | undefined) =>
  v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

export function tempoRelativo(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `há ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

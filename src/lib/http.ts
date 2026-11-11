import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { normalizar } from './monitor';
import { isValidUrl, parsePrice, round2 } from './preco';
import { repo } from './storage';
import { LOJAS, type Interpretacao, type Loja, type Oferta, type Produto } from './types';

export const COOKIE = 'uid';
export const UID_RE = /^[a-f0-9]{32}$/;
const DOIS_ANOS = 60 * 60 * 24 * 365 * 2;

export const ok = (data: Record<string, unknown> = {}, status = 200) => NextResponse.json({ success: true, ...data }, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });

/** Identifica o usuário pelo cookie (cria um novo código se não existir). */
export async function getUid(): Promise<string> {
  const jar = await cookies();
  const atual = jar.get(COOKIE)?.value;
  if (atual && UID_RE.test(atual)) return atual;
  const uid = crypto.randomUUID().replace(/-/g, '');
  setUidCookie(jar, uid);
  return uid;
}

export function setUidCookie(jar: Awaited<ReturnType<typeof cookies>>, uid: string) {
  jar.set(COOKIE, uid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: DOIS_ANOS,
    path: '/',
  });
}

/** Lê o corpo JSON. Exigir JSON também protege contra envios de formulários de outros sites (CSRF). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (!req.headers.get('content-type')?.includes('application/json')) return null;
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function precoAlvo(v: unknown): number | null {
  const p = parsePrice(v);
  return p == null || p > 10_000_000 ? null : round2(p);
}

export function limparOferta(o: unknown): Oferta | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const url = String(r.url ?? '');
  const preco = precoAlvo(r.preco);
  const loja = r.loja as Loja;
  if (!isValidUrl(url) || preco == null || !(loja in LOJAS)) return null;
  const imagem = typeof r.imagem === 'string' && isValidUrl(r.imagem) ? r.imagem : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    titulo: String(r.titulo ?? '').slice(0, 220),
    preco,
    url,
    loja,
    imagem,
    codigo: num(r.codigo),
    posicao: num(r.posicao) ?? undefined,
    pontos: num(r.pontos) ?? undefined,
    recencia: num(r.recencia),
    motivo: String(r.motivo ?? '').slice(0, 120),
  };
}

export function limparInterp(d: unknown): Interpretacao {
  const r = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const reqs = Array.isArray(r.requisitos) ? r.requisitos : [];
  return {
    termo_busca: String(r.termo_busca ?? '').slice(0, 120),
    categoria: String(r.categoria ?? '').slice(0, 60),
    requisitos: reqs.slice(0, 12).map((x) => String(x).slice(0, 80)),
    preco_maximo: r.preco_maximo == null ? null : precoAlvo(r.preco_maximo),
    resumo: String(r.resumo ?? '').slice(0, 200),
  };
}

export async function carregarProdutos(uid: string): Promise<Produto[]> {
  return (await repo.getProdutos(uid)).map((p) => normalizar(p as unknown as Record<string, unknown>));
}

/** Envolve um handler: transforma erros inesperados em resposta JSON. */
export function rota<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error('Erro inesperado', e);
      return fail('Erro interno no servidor', 500);
    }
  };
}

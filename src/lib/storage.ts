/**
 * Armazenamento dos dados de cada usuário.
 *
 * - Na Vercel: Upstash Redis via REST (variáveis KV_REST_API_URL / KV_REST_API_TOKEN,
 *   criadas automaticamente ao conectar o banco). Plano gratuito.
 * - Localmente: arquivo data.json (sem precisar de nada instalado).
 *
 * O formato das chaves é o mesmo da versão anterior em Python, então os
 * alertas que já existiam continuam funcionando.
 */
import { Redis } from '@upstash/redis';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Produto } from './types';

interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  incr(key: string, ttlSeconds: number): Promise<number>;
}

class RedisStore implements Store {
  constructor(private r: Redis) {}
  async get(key: string) {
    const v = await this.r.get<string>(key);
    return v == null ? null : String(v);
  }
  async set(key: string, value: string) {
    await this.r.set(key, value);
  }
  async keys(prefix: string) {
    const out: string[] = [];
    let cursor: string | number = 0;
    do {
      const [next, batch]: [string | number, string[]] = await this.r.scan(cursor, { match: `${prefix}*`, count: 200 });
      out.push(...batch);
      cursor = next;
    } while (String(cursor) !== '0');
    return out;
  }
  async incr(key: string, ttlSeconds: number) {
    const n = await this.r.incr(key);
    if (n === 1) await this.r.expire(key, ttlSeconds);
    return n;
  }
}

class FileStore implements Store {
  private queue: Promise<unknown> = Promise.resolve();
  private counters = new Map<string, { n: number; exp: number }>();
  constructor(private file: string) {}
  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      return {};
    }
  }
  async get(key: string) {
    return (await this.read())[key] ?? null;
  }
  set(key: string, value: string) {
    const job = this.queue.then(async () => {
      const data = await this.read();
      data[key] = value;
      await fs.writeFile(this.file, JSON.stringify(data, null, 2));
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
  async keys(prefix: string) {
    return Object.keys(await this.read()).filter((k) => k.startsWith(prefix));
  }
  async incr(key: string, ttlSeconds: number) {
    const now = Date.now();
    const c = this.counters.get(key);
    const next = c && c.exp > now ? { n: c.n + 1, exp: c.exp } : { n: 1, exp: now + ttlSeconds * 1000 };
    this.counters.set(key, next);
    return next.n;
  }
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    store = new RedisStore(new Redis({ url, token, automaticDeserialization: false }));
  } else {
    const file = process.env.DATA_FILE || (process.env.VERCEL ? '/tmp/data.json' : path.join(process.cwd(), 'data.json'));
    if (process.env.VERCEL) console.warn('Banco não configurado: dados em /tmp serão perdidos!');
    store = new FileStore(file);
  }
  return store;
}

export const tipoBanco = () => (getStore() instanceof RedisStore ? 'redis' : 'arquivo');

/** Só para testes. */
export function _setStore(s: Store | null) {
  store = s;
}

export const repo = {
  async getEmail(uid: string) {
    return getStore().get(`email:${uid}`);
  },
  async setEmail(uid: string, email: string) {
    await getStore().set(`email:${uid}`, email);
  },
  async getProdutos(uid: string): Promise<Produto[]> {
    const raw = await getStore().get(`produtos:${uid}`);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      console.error('Dados corrompidos para', uid);
      return [];
    }
  },
  async saveProdutos(uid: string, produtos: Produto[]) {
    await getStore().set(`produtos:${uid}`, JSON.stringify(produtos));
  },
  async userIds(): Promise<string[]> {
    return (await getStore().keys('produtos:')).map((k) => k.slice('produtos:'.length));
  },
  /** Limite simples de uso: devolve true se ainda pode. */
  async permitir(uid: string, acao: string, limite: number, janelaSeg: number) {
    const janela = Math.floor(Date.now() / 1000 / janelaSeg);
    return (await getStore().incr(`rl:${acao}:${uid}:${janela}`, janelaSeg)) <= limite;
  },
};

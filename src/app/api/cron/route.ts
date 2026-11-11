import { timingSafeEqual } from 'node:crypto';
import { fail, ok } from '@/lib/http';
import { normalizar, verificar } from '@/lib/monitor';
import { repo } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function autorizado(header: string | null, secret: string) {
  const a = Buffer.from(header ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verificação automática de todos os usuários (Vercel Cron). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail('CRON_SECRET não configurado', 503);
  if (!autorizado(req.headers.get('authorization'), secret)) return fail('Não autorizado', 401);

  const resumo = { usuarios: 0, produtos: 0, alertas: 0, erros: 0 };
  for (const uid of await repo.userIds()) {
    try {
      const produtos = (await repo.getProdutos(uid)).map((p) => normalizar(p as unknown as Record<string, unknown>));
      if (!produtos.length) continue;
      const resultados = await verificar(produtos, await repo.getEmail(uid));
      await repo.saveProdutos(uid, produtos);
      resumo.usuarios++;
      resumo.produtos += resultados.length;
      resumo.alertas += resultados.filter((r) => r.status === 'alerta_enviado').length;
      resumo.erros += resultados.filter((r) => r.status === 'erro').length;
    } catch (e) {
      console.error('Falha no cron para um usuário', e);
    }
  }
  console.log('Cron concluído', resumo);
  return ok(resumo);
}

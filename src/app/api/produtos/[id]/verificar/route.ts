import { carregarProdutos, fail, getUid, ok, rota } from '@/lib/http';
import { verificar } from '@/lib/monitor';
import { repo } from '@/lib/storage';

export const maxDuration = 60;

export const POST = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const uid = await getUid();
  const produtos = await carregarProdutos(uid);
  const p = produtos.find((x) => x.id === id);
  if (!p) return fail('Alerta não encontrado', 404);
  if (!(await repo.permitir(uid, 'verificar', 30, 60))) return fail('Muitas verificações seguidas. Espere um minuto.', 429);
  const [resultado] = await verificar([p], await repo.getEmail(uid));
  await repo.saveProdutos(uid, produtos);
  return ok({ resultado, produto: p });
});

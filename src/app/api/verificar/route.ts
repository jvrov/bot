import { carregarProdutos, fail, getUid, ok, rota } from '@/lib/http';
import { verificar } from '@/lib/monitor';
import { repo } from '@/lib/storage';

export const maxDuration = 60;

export const POST = rota(async () => {
  const uid = await getUid();
  const produtos = await carregarProdutos(uid);
  if (!produtos.length) return fail('Crie um alerta primeiro');
  if (!(await repo.permitir(uid, 'verificar-todos', 4, 60))) return fail('Espere um minuto antes de verificar tudo de novo.', 429);
  const resultados = await verificar(produtos, await repo.getEmail(uid));
  await repo.saveProdutos(uid, produtos);
  return ok({ resultados, produtos });
});

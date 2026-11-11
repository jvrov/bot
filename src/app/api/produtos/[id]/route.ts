import { carregarProdutos, fail, getUid, ok, precoAlvo, readJson, rota } from '@/lib/http';
import { repo } from '@/lib/storage';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const uid = await getUid();
  const produtos = await carregarProdutos(uid);
  const p = produtos.find((x) => x.id === id);
  if (!p) return fail('Alerta não encontrado', 404);

  if ('preco_desejado' in body) {
    const preco = precoAlvo(body.preco_desejado);
    if (preco == null) return fail('Informe um preço desejado válido');
    if (preco !== p.preco_desejado) {
      p.preco_desejado = preco;
      p.alertado = false;
    }
  }
  if ('nome' in body) {
    const nome = String(body.nome ?? '').trim().slice(0, 200);
    if (!nome) return fail('O nome não pode ficar vazio');
    p.nome = nome;
  }
  await repo.saveProdutos(uid, produtos);
  return ok({ message: 'Alerta atualizado!', produto: p });
});

export const DELETE = rota(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const uid = await getUid();
  const produtos = await carregarProdutos(uid);
  const restantes = produtos.filter((p) => p.id !== id);
  if (restantes.length === produtos.length) return fail('Alerta não encontrado', 404);
  await repo.saveProdutos(uid, restantes);
  return ok({ message: 'Alerta removido!' });
});

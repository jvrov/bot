import { fail, ok, readJson, rota } from '@/lib/http';
import { interpret } from '@/lib/pedido';

export const POST = rota(async (req: Request) => {
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const texto = String(body.texto ?? '').trim();
  if (texto.length < 3) return fail('Descreva o que você procura');
  return ok({ interpretacao: interpret(texto) });
});

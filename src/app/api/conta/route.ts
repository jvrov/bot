import { cookies } from 'next/headers';
import { fail, ok, readJson, rota, setUidCookie, UID_RE } from '@/lib/http';
import { repo } from '@/lib/storage';

/** Usa um código de acesso de outro aparelho para ver os mesmos alertas. */
export const POST = rota(async (req: Request) => {
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const codigo = String(body.codigo ?? '').trim().toLowerCase();
  if (!UID_RE.test(codigo)) return fail('Código inválido: são 32 letras e números');
  const [email, produtos] = await Promise.all([repo.getEmail(codigo), repo.getProdutos(codigo)]);
  if (!email && !produtos.length) return fail('Nenhum alerta encontrado com este código', 404);
  setUidCookie(await cookies(), codigo);
  return ok({ message: 'Pronto! Agora você está vendo os alertas desse código.' });
});

import { fail, getUid, ok, readJson, rota } from '@/lib/http';
import { repo } from '@/lib/storage';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const POST = rota(async (req: Request) => {
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const email = String(body.email ?? '').trim();
  if (!EMAIL_RE.test(email) || email.length > 254) return fail('Informe um email válido');
  await repo.setEmail(await getUid(), email);
  return ok({ message: 'Email salvo!' });
});

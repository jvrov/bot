import { fail, getUid, ok, rota } from '@/lib/http';
import { emailConfigurado, enviarTeste } from '@/lib/notifier';
import { repo } from '@/lib/storage';

export const POST = rota(async () => {
  const uid = await getUid();
  const email = await repo.getEmail(uid);
  if (!email) return fail('Salve um email primeiro');
  if (!emailConfigurado()) return fail('O servidor ainda não tem remetente configurado (EMAIL_USER / EMAIL_PASSWORD)', 503);
  if (!(await repo.permitir(uid, 'email-teste', 3, 600))) return fail('Muitos emails de teste. Tente em alguns minutos.', 429);
  if (!(await enviarTeste(email))) return fail('Não foi possível enviar o email de teste', 502);
  return ok({ message: `Email de teste enviado para ${email}` });
});

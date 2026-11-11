import { carregarProdutos, getUid, ok, rota } from '@/lib/http';
import { emailConfigurado } from '@/lib/notifier';
import { LOJAS_BUSCA } from '@/lib/search';
import { repo } from '@/lib/storage';
import { LOJAS } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const GET = rota(async () => {
  const uid = await getUid();
  const [email, produtos] = await Promise.all([repo.getEmail(uid), carregarProdutos(uid)]);
  return ok({ uid, email, email_configurado: emailConfigurado(), produtos, lojas: LOJAS, lojas_busca: LOJAS_BUSCA });
});

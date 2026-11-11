import { fail, getUid, ok, readJson, rota } from '@/lib/http';
import { searchStore, STORES } from '@/lib/search';
import { repo } from '@/lib/storage';
import type { Loja } from '@/lib/types';

export const maxDuration = 30;

/** Busca em UMA loja (o navegador chama uma vez por loja, em paralelo). */
export const POST = rota(async (req: Request) => {
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const termo = String(body.termo ?? '').trim().slice(0, 120);
  const loja = body.loja as Loja;
  if (!termo) return fail('Informe o termo de busca');
  if (!(loja in STORES)) return fail('Loja não suportada');
  if (!(await repo.permitir(await getUid(), 'buscar', 60, 60))) {
    return fail('Muitas buscas seguidas. Espere um minuto e tente de novo.', 429);
  }
  try {
    return ok({ loja, ofertas: await searchStore(loja, termo), erro: null });
  } catch (e) {
    return ok({ loja, ofertas: [], erro: (e as Error).message });
  }
});

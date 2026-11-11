import { fail, limparInterp, limparOferta, ok, readJson, rota } from '@/lib/http';
import { calcularRecencia, filterOffers } from '@/lib/pedido';
import type { Oferta } from '@/lib/types';

export const POST = rota(async (req: Request) => {
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const lista = Array.isArray(body.ofertas) ? body.ofertas.slice(0, 200) : [];
  const ofertas = lista.map(limparOferta).filter((o): o is Oferta => !!o);
  const compat = filterOffers(String(body.texto ?? '').slice(0, 500), limparInterp(body.interpretacao), ofertas);
  return ok({ ofertas: compat, todas: calcularRecencia(ofertas), total: ofertas.length });
});

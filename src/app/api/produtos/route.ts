import { carregarProdutos, fail, getUid, limparInterp, limparOferta, ok, precoAlvo, readJson, rota } from '@/lib/http';
import { aplicarResultado, atualizarOfertas, novaBusca, novoProduto, rodarBusca } from '@/lib/monitor';
import { isValidUrl } from '@/lib/preco';
import { fetchProduct } from '@/lib/scraper';
import { repo } from '@/lib/storage';
import type { Oferta, Produto, ScrapeResult } from '@/lib/types';

export const maxDuration = 60;
const MAX_ALERTAS = 40;

export const POST = rota(async (req: Request) => {
  const body = await readJson(req);
  if (!body) return fail('Envie os dados como JSON', 415);
  const preco = precoAlvo(body.preco_desejado);
  if (preco == null) return fail('Informe um preço desejado válido');

  const uid = await getUid();
  const produtos = await carregarProdutos(uid);
  if (produtos.length >= MAX_ALERTAS) return fail(`Limite de ${MAX_ALERTAS} alertas atingido`);
  const email = await repo.getEmail(uid);

  let produto: Produto;
  let resultado: ScrapeResult;
  let message: string;

  if (body.tipo === 'busca') {
    const texto = String(body.texto ?? '').trim().slice(0, 500);
    if (texto.length < 3) return fail('Descreva o que você procura');
    produto = novaBusca(texto, limparInterp(body.interpretacao), preco);
    const ofertas = (Array.isArray(body.ofertas) ? body.ofertas : []).map(limparOferta).filter((o): o is Oferta => !!o);
    resultado = ofertas.length ? atualizarOfertas(produto, ofertas) : await rodarBusca(produto);
    message = 'Alerta criado! Aviso quando algo compatível ficar abaixo do seu preço.';
  } else {
    const url = String(body.url ?? '').trim();
    const nome = String(body.nome ?? '').trim().slice(0, 200);
    if (!isValidUrl(url)) return fail('Informe uma URL válida (começando com http:// ou https://)');
    if (produtos.some((p) => p.tipo === 'link' && p.url === url)) return fail('Este produto já está sendo monitorado');
    const imagem = typeof body.imagem === 'string' && isValidUrl(body.imagem) ? body.imagem : null;
    const conhecido = precoAlvo(body.preco_atual);
    // Veio de uma busca: já sabemos o preço. Senão, lê a página do produto.
    resultado = conhecido ? { price: conhecido, name: nome } : await fetchProduct(url);
    produto = novoProduto(nome || resultado.name || url, url, preco, imagem);
    message = resultado.price == null ? 'Alerta criado! Não consegui ler o preço agora; tento de novo na próxima verificação.' : 'Alerta criado!';
  }

  const r = await aplicarResultado(produto, resultado, email);
  produtos.push(produto);
  await repo.saveProdutos(uid, produtos);
  return ok({ message, produto, resultado: r }, 201);
});

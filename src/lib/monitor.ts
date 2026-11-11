/** Regras de monitoramento: histórico, alertas e alertas de busca. */
import { enviarAlerta } from './notifier';
import { filterOffers } from './pedido';
import { round2 } from './preco';
import { detectStore, fetchProduct } from './scraper';
import { searchAll } from './search';
import { LOJAS, type Interpretacao, type Oferta, type Produto, type Resultado, type ScrapeResult } from './types';

export const MAX_HISTORICO = 90;
export const MAX_OFERTAS = 12;

export const agora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/** Garante todos os campos (inclusive em dados criados pela versão antiga). */
export function normalizar(raw: Record<string, unknown>): Produto {
  const p = { ...raw } as Record<string, unknown>;
  if (p.preco_desejado == null && p.preco_alvo != null) p.preco_desejado = p.preco_alvo;
  delete p.preco_alvo;
  const tipo = p.tipo === 'busca' ? 'busca' : 'link';
  const url = typeof p.url === 'string' ? p.url : '';
  const historico = Array.isArray(p.historico) ? (p.historico as Produto['historico']) : [];
  const produto: Produto = {
    id: (p.id as string) || novoId(),
    tipo,
    nome: (p.nome as string) || url || 'Produto',
    url,
    preco_desejado: Number(p.preco_desejado) || 0,
    loja: (p.loja as Produto['loja']) ?? detectStore(url),
    imagem: (p.imagem as string) ?? null,
    criado_em: (p.criado_em as string) || agora(),
    preco_atual: (p.preco_atual as number) ?? null,
    preco_inicial: (p.preco_inicial as number) ?? historico[0]?.p ?? null,
    preco_minimo: (p.preco_minimo as number) ?? null,
    ultima_verificacao: (p.ultima_verificacao as string) ?? null,
    historico,
    alertado: !!p.alertado,
    erro: (p.erro as string) ?? null,
  };
  if (tipo === 'busca') {
    produto.texto = (p.texto as string) || produto.nome;
    produto.interpretacao = (p.interpretacao as Partial<Interpretacao>) ?? {};
    produto.melhor_oferta = (p.melhor_oferta as Oferta) ?? null;
    produto.ofertas = (p.ofertas as Oferta[]) ?? [];
    produto.vistos = (p.vistos as Record<string, string>) ?? {};
    produto.novidades = (p.novidades as number) ?? 0;
  }
  return produto;
}

export function novoProduto(nome: string, url: string, precoDesejado: number, imagem: string | null = null): Produto {
  return normalizar({ nome: nome.trim(), url: url.trim(), preco_desejado: precoDesejado, imagem });
}

export function novaBusca(texto: string, interp: Partial<Interpretacao>, precoDesejado: number): Produto {
  return normalizar({ tipo: 'busca', nome: texto.trim(), texto: texto.trim(), url: '', interpretacao: interp, preco_desejado: precoDesejado });
}

/** Guarda as ofertas compatíveis, marca as novas e devolve o melhor preço. */
export function atualizarOfertas(p: Produto, ofertas: Oferta[]): ScrapeResult {
  const ordenadas = [...ofertas].sort((a, b) => a.preco - b.preco);
  const vistos = p.vistos ?? {};
  const primeiraVez = Object.keys(vistos).length === 0;
  const quando = agora();
  let novidades = 0;
  const marcadas = ordenadas.map((o) => {
    const ja = vistos[o.url];
    if (!ja) {
      vistos[o.url] = quando;
      if (!primeiraVez) novidades++;
    }
    return { ...o, visto_em: ja ?? quando, novo: !ja && !primeiraVez };
  });
  // Mantém o registro de vistos sob controle
  const urls = Object.entries(vistos).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 300);
  p.vistos = Object.fromEntries(urls);
  p.novidades = novidades;
  p.ofertas = marcadas.slice(0, MAX_OFERTAS);
  if (!marcadas.length) return { price: null, error: 'Nenhuma oferta compatível encontrada agora' };
  const best = marcadas[0];
  p.melhor_oferta = best;
  p.url = best.url;
  p.loja = best.loja;
  p.imagem = best.imagem ?? p.imagem;
  return { price: best.preco, name: best.titulo };
}

export async function rodarBusca(p: Produto): Promise<ScrapeResult> {
  const interp = { termo_busca: p.texto ?? p.nome, categoria: '', requisitos: [], preco_maximo: null, resumo: '', ...p.interpretacao } as Interpretacao;
  const { ofertas, erros } = await searchAll(interp.termo_busca);
  if (!ofertas.length) {
    const detalhe = Object.entries(erros).map(([k, v]) => `${LOJAS[k as keyof typeof LOJAS]}: ${v}`).join('; ');
    return { price: null, error: `Nenhuma loja respondeu (${detalhe})` };
  }
  return atualizarOfertas(p, filterOffers(p.texto ?? '', interp, ofertas));
}

/**
 * Atualiza o produto com o resultado e envia alerta se preciso.
 * Um alerta só é enviado uma vez por "queda": se o preço voltar a subir acima
 * do alvo, o próximo recuo dispara um novo email.
 */
export async function aplicarResultado(p: Produto, r: ScrapeResult, email: string | null): Promise<Resultado> {
  p.ultima_verificacao = agora();
  if (r.price == null) {
    p.erro = r.error || 'Preço não encontrado';
    return { id: p.id, nome: p.nome, status: 'erro', mensagem: p.erro };
  }
  const preco = round2(r.price);
  p.erro = null;
  p.preco_atual = preco;
  if (p.preco_inicial == null) p.preco_inicial = preco;
  if (p.preco_minimo == null || preco < p.preco_minimo) p.preco_minimo = preco;
  if (!p.imagem && r.image) p.imagem = r.image;
  p.historico.push({ t: p.ultima_verificacao, p: preco });
  p.historico = p.historico.slice(-MAX_HISTORICO);

  const base = { id: p.id, nome: p.nome, preco_atual: preco, preco_desejado: p.preco_desejado };
  if (preco > p.preco_desejado) {
    p.alertado = false;
    return { ...base, status: 'monitorado' };
  }
  if (p.alertado) return { ...base, status: 'abaixo_do_alvo' };
  if (email && (await enviarAlerta(email, p, preco))) {
    p.alertado = true;
    return { ...base, status: 'alerta_enviado' };
  }
  return { ...base, status: 'abaixo_do_alvo', mensagem: email ? 'Falha ao enviar o email' : 'Email não configurado' };
}

const buscar = (p: Produto) => (p.tipo === 'busca' ? rodarBusca(p) : fetchProduct(p.url));

/** Verifica vários produtos em paralelo (com limite de concorrência). */
export async function verificar(produtos: Produto[], email: string | null, concorrencia = 6): Promise<Resultado[]> {
  const resultados: ScrapeResult[] = new Array(produtos.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concorrencia, produtos.length) }, async () => {
      while (i < produtos.length) {
        const k = i++;
        resultados[k] = await buscar(produtos[k]);
      }
    }),
  );
  const out: Resultado[] = [];
  for (let k = 0; k < produtos.length; k++) out.push(await aplicarResultado(produtos[k], resultados[k], email));
  return out;
}

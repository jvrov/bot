export type Loja = 'kabum' | 'mercadolivre' | 'amazon' | 'magazineluiza';

export const LOJAS: Record<Loja, string> = {
  kabum: 'KaBuM!',
  mercadolivre: 'Mercado Livre',
  amazon: 'Amazon',
  magazineluiza: 'Magazine Luiza',
};

/** Um anúncio encontrado numa busca. */
export interface Oferta {
  titulo: string;
  preco: number;
  url: string;
  loja: Loja;
  imagem: string | null;
  /** Código numérico do anúncio na loja (quanto maior, mais novo). */
  codigo?: number | null;
  /** Posição na página da loja (0 = mais relevante para a loja). */
  posicao?: number;
  /** Por que o anúncio bate com o pedido. */
  motivo?: string;
  /** Quantas características pedidas o anúncio cumpre. */
  pontos?: number;
  /** 0..1 – quão recente o anúncio é em relação aos outros da mesma loja. */
  recencia?: number | null;
  /** Primeira vez que vimos este anúncio (apenas em alertas de busca). */
  visto_em?: string;
  novo?: boolean;
}

export interface Interpretacao {
  termo_busca: string;
  categoria: string;
  requisitos: string[];
  preco_maximo: number | null;
  resumo: string;
}

export interface PontoHistorico {
  t: string;
  p: number;
}

export interface Produto {
  id: string;
  tipo: 'link' | 'busca';
  nome: string;
  url: string;
  preco_desejado: number;
  loja: Loja | null;
  imagem: string | null;
  criado_em: string;
  preco_atual: number | null;
  preco_inicial: number | null;
  preco_minimo: number | null;
  ultima_verificacao: string | null;
  historico: PontoHistorico[];
  alertado: boolean;
  erro: string | null;
  // Somente alertas de busca
  texto?: string;
  interpretacao?: Partial<Interpretacao>;
  melhor_oferta?: Oferta | null;
  ofertas?: Oferta[];
  vistos?: Record<string, string>;
  novidades?: number;
}

export type StatusResultado = 'monitorado' | 'abaixo_do_alvo' | 'alerta_enviado' | 'erro';

export interface Resultado {
  id: string;
  nome: string;
  status: StatusResultado;
  preco_atual?: number;
  preco_desejado?: number;
  mensagem?: string;
}

export interface ScrapeResult {
  price: number | null;
  name?: string | null;
  image?: string | null;
  error?: string | null;
}

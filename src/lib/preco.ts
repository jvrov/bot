/**
 * Converte textos como "R$ 1.234,56", "1234.56" ou "1.299" em número.
 * Entende o formato brasileiro (ponto = milhar, vírgula = decimal) e o
 * internacional (vírgula = milhar, ponto = decimal).
 */
export function parsePrice(input: unknown): number | null {
  if (input == null || typeof input === 'boolean') return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;

  let s = String(input).replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2 || parts[parts.length - 1].length === 3) s = s.replace(/\./g, '');
  }
  const value = Number.parseFloat(s);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** 1234.5 -> "R$ 1.234,50" */
export function brl(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

import type { Order, OrderItem } from './types';

/** Preços base usados para sugerir o preço de cada artigo (editáveis no backoffice, guardados em config/precos). */
export interface PrecosBase {
  semPers: number;
  comPers: number;
}

export const PRECOS_PADRAO: PrecosBase = { semPers: 20, comPers: 25 };

/** Tem personalização: nome, número ou patches. */
export const personalizado = (i: OrderItem): boolean => !!(i.name || i.number || i.patches.length);

export const precoSugerido = (i: OrderItem, base: PrecosBase): number => (personalizado(i) ? base.comPers : base.semPers);

/** A encomenda já tem preço definido no backoffice? */
export const temPreco = (o: Order): boolean => o.total != null;

/** Soma: preço × quantidade de cada artigo + portes/ajuste. */
export function calcularTotal(precos: number[], qtds: number[], extra: number): number {
  const t = precos.reduce((s, p, k) => s + p * (qtds[k] ?? 1), 0) + extra;
  return Math.round(t * 100) / 100;
}

export function fmtEur(n: number): string {
  return n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
}

/** Lê um valor escrito à portuguesa ("12,50", "12.5", "12 €"); NaN se inválido. */
export function lerEur(t: string): number {
  const v = t.replace(/[€\s]/g, '').replace(',', '.');
  return v === '' || v === '-' ? NaN : Number(v);
}

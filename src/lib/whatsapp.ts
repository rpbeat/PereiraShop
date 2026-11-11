import type { Order, OrderItem } from './types';
import { orderCode } from './ui';

/**
 * Texto para o fornecedor, no formato usado no WhatsApp:
 *   SIZE: S
 *   NAME: QUARESMA
 *   NUMBER: 23
 *   PATCH: LIGA PORTUGAL
 * As linhas sem conteúdo são omitidas.
 */
export function itemMessage(i: OrderItem): string {
  const lines = [`SIZE: ${i.size}`];
  if (i.name) lines.push(`NAME: ${i.name.toUpperCase()}`);
  if (i.number) lines.push(`NUMBER: ${i.number}`);
  if (i.patches.length) lines.push(`PATCH: ${i.patches.join(' + ').toUpperCase()}`);
  if (i.qty > 1) lines.push(`QTY: ${i.qty}`);
  return lines.join('\n');
}

/** Resumo interno da encomenda completa. */
export function orderSummary(o: Order): string {
  const lines = [`ENCOMENDA #${orderCode(o.id)}`, `${o.customer.name} · ${o.customer.phone}`, ''];
  o.items.forEach((i, k) => {
    lines.push(`${k + 1}) ${i.title}`, itemMessage(i));
    if (i.notes) lines.push(`Obs.: ${i.notes}`);
    lines.push('');
  });
  if (o.notes) lines.push(`Notas: ${o.notes}`);
  return lines.join('\n').trim();
}

/** Link wa.me para o telemóvel do cliente (assume +351 para números de 9 dígitos começados por 9). */
export function waLink(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('9')) d = `351${d}`;
  return d.length >= 9 ? `https://wa.me/${d}` : '';
}

/** Converte qualquer imagem (jpeg/webp/png) num PNG — o único formato de imagem aceite pela Clipboard API. */
async function toPngBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Falha a obter imagem (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha a converter imagem'))), 'image/png'),
  );
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// A promessa é passada diretamente ao ClipboardItem para não perder o "gesto do utilizador" (Safari).
export async function copyImage(url: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPngBlob(url) })]);
}

export async function copyImageAndText(url: string, text: string): Promise<void> {
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': toPngBlob(url),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    }),
  ]);
}

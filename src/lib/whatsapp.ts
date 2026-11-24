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

/**
 * Uma só imagem com a foto em cima e o texto da encomenda por baixo (como uma mensagem do WhatsApp).
 * O WhatsApp Web só aceita uma coisa por colagem (imagem OU texto); assim vai tudo de uma vez.
 */
export async function imagemComTexto(url: string, text: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Falha a obter imagem (${res.status})`);
  const bmp = await createImageBitmap(await res.blob());
  const W = Math.min(1080, bmp.width);
  const fotoH = Math.round((bmp.height * W) / bmp.width);
  const k = W / 1080; // tudo proporcional à largura
  const linhas = text.split('\n');
  const fonte = Math.round(54 * k);
  const entre = Math.round(fonte * 1.38);
  const pad = Math.round(44 * k);
  const textoH = pad * 2 + entre * linhas.length - (entre - fonte);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = fotoH + textoH;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, W, fotoH);
  bmp.close();
  ctx.fillStyle = '#e1f8d0';
  ctx.fillRect(0, fotoH, W, textoH);
  ctx.fillStyle = '#111b21';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${fonte}px "Segoe UI", Arial, Helvetica, sans-serif`;
  linhas.forEach((l, i) => ctx.fillText(l, pad, fotoH + pad + i * entre, W - pad * 2));
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha a gerar imagem'))), 'image/png'));
}

/** Copia a imagem com o texto por baixo (uma colagem leva tudo). */
export async function copyImageWithText(url: string, text: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': imagemComTexto(url, text) })]);
}

/** O browser consegue partilhar ficheiros (telemóvel; Windows com Chrome/Edge)? */
export function podePartilhar(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File([new Blob()], 'teste.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

// ficheiros já preparados: o 2.º toque partilha logo (alguns browsers só deixam partilhar logo após o toque)
const prontos = new Map<string, File>();

/** Abre a partilha do sistema com a foto e o texto como legenda (no WhatsApp: imagem + legenda). */
export async function partilhar(url: string, text: string, nome: string): Promise<'ok' | 'repetir'> {
  let f = prontos.get(url);
  if (!f) {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error(`Falha a obter imagem (${r.status})`);
    const b = await r.blob();
    f = new File([b], `${nome.replace(/[^\w-]+/g, '_') || 'camisola'}.${b.type.includes('png') ? 'png' : 'jpg'}`, { type: b.type || 'image/jpeg' });
    prontos.set(url, f);
  }
  try {
    await navigator.share({ files: [f], text });
    return 'ok';
  } catch (err) {
    if ((err as DOMException)?.name === 'NotAllowedError') return 'repetir';
    if ((err as DOMException)?.name === 'AbortError') return 'ok'; // o utilizador fechou a janela
    throw err;
  }
}

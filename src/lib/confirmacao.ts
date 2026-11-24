/**
 * Imagem de confirmação da encomenda (para enviar ao cliente pelo WhatsApp).
 * Desenhada em canvas: cabeçalho com o logótipo, número e estado, todos os artigos com foto
 * e personalização, morada de entrega e uma mensagem de acordo com o estado da encomenda.
 */
import { LOGO_ICON } from './logo';
import { STATUS_LABELS, type Order, type OrderStatus } from './types';
import { orderCode } from './ui';

const COR = {
  relvado: '#0f3d2e',
  campo: '#1e6b4c',
  cal: '#f2f5f1',
  folha: '#dce8de',
  taca: '#c9a54b',
  tinta: '#13231c',
  cinza: '#5b6c63',
  linha: '#d5dfd7',
};
const DISPLAY = '"Big Shoulders Display", "Arial Narrow", Arial, sans-serif';
const SANS = '"Hanken Grotesk", "Segoe UI", Arial, sans-serif';

const MENSAGEM: Record<OrderStatus, string> = {
  pendente: 'Recebemos a tua encomenda. Falamos contigo com os dados de pagamento.',
  paga: 'Pagamento recebido. Já estamos a tratar da tua encomenda.',
  encomendada: 'A tua encomenda já foi pedida. Avisamos quando seguir para ti.',
  enviada: 'A tua encomenda já está a caminho.',
  entregue: 'Encomenda entregue. Obrigado e bons jogos!',
  cancelada: 'Esta encomenda foi cancelada.',
};

/** Logótipo com as cores da versão escura (o SVG do site usa variáveis CSS). */
function logoSvg(): string {
  const estilo = `<style>
    .lg-boot{fill:#f2f5f1}.lg-heel{fill:#dce8de}.lg-lace{stroke:#1e6b4c}.lg-sole{fill:#c9a54b}
    .lg-chain{stroke:#9aa7a0}.lg-ball{fill:#2b3236}.lg-pb{fill:#c9a54b;font:900 26px Arial Narrow,Arial,sans-serif}
    .lg-shine{stroke:rgba(255,255,255,.28)}.lg-weight{stroke:rgba(255,255,255,.35)}</style>`;
  return LOGO_ICON.replace('<svg class="logo-icon"', '<svg xmlns="http://www.w3.org/2000/svg" width="336" height="284"')
    .replace(' aria-hidden="true" focusable="false">', `>${estilo}`);
}

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('imagem'));
    img.src = src;
  });
}

async function foto(url: string): Promise<ImageBitmap | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

/** Parte um texto em linhas que caibam na largura. */
function partir(ctx: CanvasRenderingContext2D, texto: string, largura: number, maxLinhas = 3): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = '';
  for (const p of palavras) {
    const t = atual ? `${atual} ${p}` : p;
    if (ctx.measureText(t).width <= largura || !atual) atual = t;
    else {
      linhas.push(atual);
      atual = p;
    }
  }
  if (atual) linhas.push(atual);
  if (linhas.length > maxLinhas) {
    const r = linhas.slice(0, maxLinhas);
    r[maxLinhas - 1] = `${r[maxLinhas - 1]!.replace(/\s+\S*$/, '')}…`;
    return r;
  }
  return linhas;
}

function retangulo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function imagemConfirmacao(o: Order, nomeLoja: string): Promise<Blob> {
  // garante que as letras do site estão prontas (se não, usa as alternativas)
  await Promise.allSettled([
    document.fonts.load(`900 80px ${DISPLAY}`),
    document.fonts.load(`700 30px ${SANS}`),
    document.fonts.load(`400 30px ${SANS}`),
  ]);
  const [logo, ...fotos] = await Promise.all([
    carregarImagem(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg())}`).catch(() => null),
    ...o.items.map((i) => foto(i.imageUrl)),
  ]);

  const W = 1080;
  const M = 64; // margem
  const FOTO = 200;
  const medir = document.createElement('canvas').getContext('2d')!;

  // ---- calcular as alturas antes de desenhar
  const c = o.customer;
  const linhasItem = o.items.map((i) => {
    medir.font = `700 38px ${SANS}`;
    const titulo = partir(medir, i.title, W - M * 2 - FOTO - 36, 2);
    const det: string[] = [`Tamanho ${i.size}`];
    if (i.name || i.number) det.push(`Nome ${i.name || '—'}  ·  Número ${i.number || '—'}`);
    if (i.patches.length) det.push(`Patches: ${i.patches.join(', ')}`);
    if (i.qty > 1) det.push(`Quantidade: ${i.qty}`);
    if (i.notes) det.push(`Obs.: ${i.notes}`);
    const h = Math.max(FOTO, titulo.length * 46 + 12 + det.length * 40);
    return { titulo, det, h };
  });
  const morada = [c.name, c.address, [c.postalCode, c.city].filter(Boolean).join(' '), c.phone].filter(Boolean);
  medir.font = `400 32px ${SANS}`;
  const notas = o.notes ? partir(medir, o.notes, W - M * 2, 4) : [];
  medir.font = `400 34px ${SANS}`;
  const msg = partir(medir, MENSAGEM[o.status], W - M * 2, 3);

  const HEAD = 250;
  const INTRO = 210;
  const ITENS = linhasItem.reduce((s, l) => s + l.h + 48, 0) + 70;
  const ENTREGA = 90 + morada.length * 44 + (notas.length ? 70 + notas.length * 42 : 0);
  const FIM = 80 + msg.length * 46 + 70;
  const H = HEAD + INTRO + ITENS + ENTREGA + FIM;

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  // ---- cabeçalho
  ctx.fillStyle = COR.relvado;
  ctx.fillRect(0, 0, W, HEAD);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let x = 0; x < W; x += 128) ctx.fillRect(x, 0, 64, HEAD); // faixas de relva
  if (logo) ctx.drawImage(logo, M, 52, 168, 142);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 92px ${DISPLAY}`;
  ctx.fillText(nomeLoja, M + 196, 140);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `700 40px ${DISPLAY}`;
  ctx.fillText('Confirmação de encomenda', M + 198, 192);

  // ---- número, data, estado
  let y = HEAD + 96;
  ctx.fillStyle = COR.tinta;
  ctx.font = `900 76px ${DISPLAY}`;
  ctx.fillText(`#${orderCode(o.id)}`, M, y);
  const estado = STATUS_LABELS[o.status];
  ctx.font = `700 30px ${SANS}`;
  const ew = ctx.measureText(estado).width + 44;
  retangulo(ctx, W - M - ew, y - 50, ew, 56, 28);
  ctx.fillStyle = o.status === 'cancelada' ? '#eef0ee' : o.status === 'pendente' ? '#f8edcf' : COR.folha;
  ctx.fill();
  ctx.fillStyle = o.status === 'pendente' ? '#7a5300' : COR.relvado;
  ctx.fillText(estado, W - M - ew + 22, y - 12);
  y += 56;
  ctx.fillStyle = COR.cinza;
  ctx.font = `400 32px ${SANS}`;
  const data = o.createdAt ? o.createdAt.toDate().toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const nArt = o.items.reduce((s, i) => s + i.qty, 0);
  ctx.fillText(`${data ? `${data}, ` : ''}${nArt} ${nArt === 1 ? 'artigo' : 'artigos'}`, M, y);
  y = HEAD + INTRO;

  // ---- artigos
  ctx.fillStyle = COR.linha;
  ctx.fillRect(M, y - 30, W - M * 2, 2);
  y += 20;
  o.items.forEach((_, k) => {
    const l = linhasItem[k]!;
    const f = fotos[k];
    retangulo(ctx, M, y, FOTO, FOTO, 18);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = COR.folha;
    ctx.fillRect(M, y, FOTO, FOTO);
    if (f) {
      const s = Math.min(f.width, f.height);
      ctx.drawImage(f, (f.width - s) / 2, (f.height - s) / 2, s, s, M, y, FOTO, FOTO);
    }
    ctx.restore();
    const tx = M + FOTO + 36;
    let ty = y + 40;
    ctx.fillStyle = COR.tinta;
    ctx.font = `700 38px ${SANS}`;
    l.titulo.forEach((t) => {
      ctx.fillText(t, tx, ty);
      ty += 46;
    });
    ty += 8;
    ctx.font = `400 31px ${SANS}`;
    l.det.forEach((d, j) => {
      ctx.fillStyle = j === 0 ? COR.campo : COR.cinza;
      if (j === 0) ctx.font = `700 31px ${SANS}`;
      ctx.fillText(d, tx, ty, W - tx - M);
      if (j === 0) ctx.font = `400 31px ${SANS}`;
      ty += 40;
    });
    y += l.h + 24;
    if (k < o.items.length - 1) {
      ctx.fillStyle = COR.linha;
      ctx.fillRect(tx, y, W - tx - M, 2);
    }
    y += 24;
  });
  y += 50;

  // ---- entrega
  ctx.fillStyle = COR.linha;
  ctx.fillRect(M, y - 40, W - M * 2, 2);
  ctx.fillStyle = COR.tinta;
  ctx.font = `800 44px ${DISPLAY}`;
  ctx.fillText('Entrega', M, y + 14);
  y += 66;
  ctx.font = `400 32px ${SANS}`;
  morada.forEach((m, j) => {
    ctx.fillStyle = j === 0 ? COR.tinta : COR.cinza;
    ctx.fillText(m, M, y, W - M * 2);
    y += 44;
  });
  if (notas.length) {
    y += 26;
    ctx.fillStyle = COR.tinta;
    ctx.font = `800 36px ${DISPLAY}`;
    ctx.fillText('Notas', M, y);
    y += 44;
    ctx.font = `400 32px ${SANS}`;
    ctx.fillStyle = COR.cinza;
    notas.forEach((n) => {
      ctx.fillText(n, M, y);
      y += 42;
    });
  }

  // ---- rodapé
  const fy = H - FIM;
  ctx.fillStyle = COR.relvado;
  ctx.fillRect(0, fy, W, FIM);
  ctx.fillStyle = COR.taca;
  ctx.fillRect(0, fy, W, 6);
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 34px ${SANS}`;
  msg.forEach((m, j) => ctx.fillText(m, M, fy + 72 + j * 46));
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `800 36px ${DISPLAY}`;
  ctx.fillText('Obrigado, craque!', M, fy + 72 + msg.length * 46 + 12);

  fotos.forEach((f) => f?.close());
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha a gerar imagem'))), 'image/png'));
}

export async function copiarConfirmacao(o: Order, nomeLoja: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': imagemConfirmacao(o, nomeLoja) })]);
}

const prontas = new Map<string, File>();

/** Partilha a imagem pela janela do sistema (WhatsApp no telemóvel). */
export async function partilharConfirmacao(o: Order, nomeLoja: string): Promise<'ok' | 'repetir'> {
  const chave = `${o.id}:${o.status}:${o.items.length}`;
  let f = prontas.get(chave);
  if (!f) {
    f = new File([await imagemConfirmacao(o, nomeLoja)], `encomenda-${orderCode(o.id)}.png`, { type: 'image/png' });
    prontas.set(chave, f);
  }
  try {
    await navigator.share({ files: [f], text: `${nomeLoja}: encomenda #${orderCode(o.id)}` });
    return 'ok';
  } catch (err) {
    if ((err as DOMException)?.name === 'NotAllowedError') return 'repetir';
    if ((err as DOMException)?.name === 'AbortError') return 'ok';
    throw err;
  }
}

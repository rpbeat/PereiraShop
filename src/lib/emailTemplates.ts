import { fmtEur } from './precos';
import type { Order, OrderStatus } from './types';
import { esc, orderCode } from './ui';

/**
 * Textos dos emails enviados aos clientes (pela extensão "Trigger Email from Firestore").
 * Usado pela loja (encomenda recebida) e pelo backoffice (mudanças de estado, conta aprovada).
 */

export interface MensagemEmail {
  subject: string;
  text: string;
  html: string;
}

export const SITE = (): string => `${location.origin}/`;

const COR = { relvado: '#0F3D2E', campo: '#1E6B4C', taca: '#C9A54B', tinta: '#13231C', cinza: '#5d6b64', folha: '#DCE8DE', cal: '#F2F5F1' };

export function moldura(titulo: string, corpo: string, rodape = 'Recebeste este email porque tens conta na loja Pé de Chumbo.'): string {
  return `<!doctype html><html lang="pt-PT"><body style="margin:0;background:${COR.cal};font-family:Arial,Helvetica,sans-serif;color:${COR.tinta}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.cal};padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td style="background:${COR.relvado};padding:22px 28px;color:#ffffff">
        <div style="font-size:26px;font-weight:800;letter-spacing:.01em">Pé de Chumbo</div>
        <div style="font-size:14px;color:${COR.taca};margin-top:2px">${esc(titulo)}</div>
      </td></tr>
      <tr><td style="padding:26px 28px;font-size:16px;line-height:1.55">${corpo}</td></tr>
      <tr><td style="padding:16px 28px 24px;font-size:12px;color:${COR.cinza};border-top:1px solid ${COR.folha}">${esc(rodape)}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

const botao = (href: string, texto: string): string =>
  `<p style="margin:22px 0 6px"><a href="${href}" style="background:${COR.campo};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">${esc(texto)}</a></p>`;

const ola = (nome: string): string => {
  const primeiro = nome.trim().split(/\s+/)[0] || '';
  return primeiro ? `Olá ${primeiro},` : 'Olá,';
};

/* ---------- conta aprovada ---------- */

export function emailContaAprovadaMsg(nome: string): MensagemEmail {
  const o = ola(nome);
  return {
    subject: 'A tua conta Pé de Chumbo foi aprovada',
    text: `${o}\n\nA tua conta na Pé de Chumbo foi aprovada. Já podes entrar com o teu email e palavra-passe, escolher a camisola, o nome e o número.\n\n${SITE()}\n\nEm campo podes ser um desastre, mas pelo menos vais bem vestido.\nPé de Chumbo`,
    html: moldura(
      'Conta aprovada',
      `<p style="margin:0 0 14px">${esc(o)}</p>
       <p style="margin:0 0 14px">A tua conta na <b>Pé de Chumbo</b> foi aprovada. Já podes entrar com o teu email e palavra-passe, escolher a camisola, o nome e o número.</p>
       ${botao(SITE(), 'Entrar na loja')}
       <p style="margin:16px 0 0;color:${COR.cinza}">Em campo podes ser um desastre, mas pelo menos vais bem vestido.</p>`,
      'Recebeste este email porque criaste conta na loja Pé de Chumbo.',
    ),
  };
}

/* ---------- encomendas ---------- */

export type TipoEmailEncomenda = 'recebida' | OrderStatus;

const TEXTOS: Record<TipoEmailEncomenda, { titulo: string; assunto: (c: string) => string; corpo: string; fim?: string }> = {
  recebida: {
    titulo: 'Encomenda em processamento',
    assunto: (c) => `Recebemos a tua encomenda #${c}`,
    corpo: 'Recebemos a tua encomenda e já está em processamento. Vamos confirmar tudo com o fornecedor e falamos contigo com o total e os dados de pagamento.',
    fim: 'Obrigado, craque!',
  },
  pendente: {
    titulo: 'Encomenda em análise',
    assunto: (c) => `A tua encomenda #${c} está em análise`,
    corpo: 'A tua encomenda está em análise. Falamos contigo com o total e os dados de pagamento.',
  },
  paga: {
    titulo: 'Pagamento recebido',
    assunto: (c) => `Pagamento recebido · encomenda #${c}`,
    corpo: 'Recebemos o teu pagamento. Vamos já encomendar as tuas camisolas, mais rápido do que um contra-ataque.',
  },
  encomendada: {
    titulo: 'Encomendada ao fornecedor',
    assunto: (c) => `A tua encomenda #${c} já foi pedida ao fornecedor`,
    corpo: 'As tuas camisolas já foram encomendadas ao fornecedor. Agora é esperar pelo apito: avisamos-te assim que seguirem para ti.',
  },
  enviada: {
    titulo: 'A caminho',
    assunto: (c) => `A tua encomenda #${c} vai a caminho`,
    corpo: 'A tua encomenda já foi enviada e está a caminho. Vai mais depressa do que tu a recuperar a bola.',
  },
  entregue: {
    titulo: 'Encomenda entregue',
    assunto: (c) => `Encomenda #${c} entregue`,
    corpo: 'A tua encomenda foi entregue. Que te assente bem: os golos não garantimos, mas o estilo está assegurado.',
    fim: 'Obrigado pela confiança!',
  },
  cancelada: {
    titulo: 'Encomenda cancelada',
    assunto: (c) => `A tua encomenda #${c} foi cancelada`,
    corpo: 'A tua encomenda foi cancelada. Se tiveres alguma dúvida, responde a este email ou fala connosco.',
  },
};

function linhaArtigo(o: Order, k: number): { html: string; text: string } {
  const i = o.items[k]!;
  const det = [`Tamanho ${i.size}`];
  const pers = [i.name, i.number].filter(Boolean).join(' ');
  if (pers) det.push(`Personalização ${pers}`);
  if (i.patches.length) det.push(`Patches ${i.patches.join(', ')}`);
  if (i.qty > 1) det.push(`Qtd. ${i.qty}`);
  const preco = o.total != null && typeof i.price === 'number' ? (i.qty > 1 ? `${i.qty} × ${fmtEur(i.price)}` : fmtEur(i.price)) : '';
  const img = i.imageUrl
    ? `<img src="${esc(i.imageUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:8px;background:${COR.cal}">`
    : `<div style="width:64px;height:64px;border-radius:8px;background:${COR.cal}"></div>`;
  return {
    html: `<tr>
      <td style="padding:10px 12px 10px 0;border-top:1px solid ${COR.folha};width:64px;vertical-align:top">${img}</td>
      <td style="padding:10px 0;border-top:1px solid ${COR.folha};vertical-align:top">
        <div style="font-weight:700">${esc(i.title)}</div>
        <div style="font-size:14px;color:${COR.cinza}">${esc(det.join(' · '))}</div>
        ${i.notes ? `<div style="font-size:13px;color:${COR.cinza}">Obs.: ${esc(i.notes)}</div>` : ''}
      </td>
      <td style="padding:10px 0 10px 12px;border-top:1px solid ${COR.folha};text-align:right;white-space:nowrap;vertical-align:top;font-weight:700">${esc(preco)}</td>
    </tr>`,
    text: `- ${i.title} (${det.join(', ')})${preco ? ` — ${preco}` : ''}`,
  };
}

/** Email sobre uma encomenda: "recebida" (logo após o cliente encomendar) ou o novo estado. */
export function emailEncomendaMsg(o: Order, tipo: TipoEmailEncomenda): MensagemEmail {
  const t = TEXTOS[tipo];
  const c = orderCode(o.id);
  const o1 = ola(o.customer.name);
  const linhas = o.items.map((_, k) => linhaArtigo(o, k));
  const comTotal = o.total != null;
  const extra = comTotal && o.extra ? `${o.extra < 0 ? 'Desconto' : 'Portes / outros'}: ${fmtEur(o.extra)}` : '';
  const link = `${SITE()}#/encomendas`;

  const html = moldura(
    t.titulo,
    `<p style="margin:0 0 14px">${esc(o1)}</p>
     <p style="margin:0 0 18px">${esc(t.corpo)}</p>
     <div style="font-size:13px;color:${COR.cinza};text-transform:none;margin-bottom:6px">Encomenda <b style="color:${COR.tinta}">#${esc(c)}</b> · ${o.items.length} ${o.items.length === 1 ? 'artigo' : 'artigos'}</div>
     <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px">
       ${linhas.map((l) => l.html).join('')}
       ${extra ? `<tr><td></td><td style="padding:8px 0;border-top:1px solid ${COR.folha};color:${COR.cinza}">${esc(extra.split(':')[0]!)}</td><td style="padding:8px 0;border-top:1px solid ${COR.folha};text-align:right;color:${COR.cinza}">${esc(fmtEur(o.extra))}</td></tr>` : ''}
       ${comTotal ? `<tr><td></td><td style="padding:12px 0;border-top:2px solid ${COR.tinta};font-weight:800;font-size:18px">Total</td><td style="padding:12px 0;border-top:2px solid ${COR.tinta};text-align:right;font-weight:800;font-size:18px;color:${COR.campo}">${esc(fmtEur(o.total!))}</td></tr>` : ''}
     </table>
     ${o.notes ? `<p style="margin:14px 0 0;font-size:14px;color:${COR.cinza}">Notas: ${esc(o.notes)}</p>` : ''}
     ${botao(link, 'Ver as minhas encomendas')}
     ${t.fim ? `<p style="margin:16px 0 0;color:${COR.cinza}">${esc(t.fim)}</p>` : ''}`,
  );

  const text = [
    o1,
    '',
    t.corpo,
    '',
    `Encomenda #${c}`,
    ...linhas.map((l) => l.text),
    ...(extra ? [extra] : []),
    ...(comTotal ? [`TOTAL: ${fmtEur(o.total!)}`] : []),
    ...(o.notes ? ['', `Notas: ${o.notes}`] : []),
    '',
    `Acompanha a encomenda em: ${link}`,
    ...(t.fim ? ['', t.fim] : []),
    'Pé de Chumbo',
  ].join('\n');

  return { subject: t.assunto(c), text, html };
}

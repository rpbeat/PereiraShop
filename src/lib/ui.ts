import type { Timestamp } from 'firebase/firestore';
import type { OrderItem } from './types';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] ?? c);

export const orderCode = (id: string): string => id.slice(0, 6).toUpperCase();

export function fmtDate(ts: Timestamp | null | undefined): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
}

export function toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
  let box = document.querySelector<HTMLElement>('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.classList.add('out'), kind === 'err' ? 5000 : 3000);
  setTimeout(() => el.remove(), kind === 'err' ? 5400 : 3400);
}

export function authError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email ou palavra-passe incorretos.';
    case 'auth/email-already-in-use':
      return 'Já existe uma conta com este email.';
    case 'auth/weak-password':
      return 'A palavra-passe deve ter pelo menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'Email inválido.';
    case 'auth/too-many-requests':
      return 'Demasiadas tentativas. Tenta outra vez daqui a pouco.';
    case 'auth/network-request-failed':
      return 'Sem ligação à internet.';
    default:
      console.error(err);
      return 'Ocorreu um erro. Tenta outra vez.';
  }
}

/** Lista de detalhes de uma linha (carrinho / encomenda do cliente). */
export function itemDetails(i: OrderItem): string {
  const parts = [`Tamanho <b>${esc(i.size)}</b>`];
  const custom = [i.name, i.number].filter(Boolean).join(' ');
  if (custom) parts.push(`Personalização <b>${esc(custom)}</b>`);
  if (i.patches.length) parts.push(`Patches <b>${esc(i.patches.join(', '))}</b>`);
  parts.push(`Qtd. <b>${i.qty}</b>`);
  return (
    `<ul class="details-list">${parts.map((p) => `<li>${p}</li>`).join('')}</ul>` +
    (i.notes ? `<p class="muted small">${esc(i.notes)}</p>` : '')
  );
}

/* ---------- loaders ---------- */

/** Bloco "a carregar" para páginas e listas (substitui o texto simples). */
export function loaderHtml(msg = 'A carregar…'): string {
  return `<div class="loader" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${esc(msg)}</span></div>`;
}

// Barra fina no topo do ecrã enquanto há trabalho em curso (contador: várias ações ao mesmo tempo).
let emCurso = 0;
let barraTimer = 0;
function barra(): HTMLElement {
  let b = document.querySelector<HTMLElement>('.barra-carga');
  if (!b) {
    b = document.createElement('div');
    b.className = 'barra-carga';
    b.setAttribute('aria-hidden', 'true');
    document.body.append(b);
  }
  return b;
}
/** Liga/desliga a barra de carregamento do topo. */
export function carregamento(on: boolean): void {
  emCurso = Math.max(0, emCurso + (on ? 1 : -1));
  clearTimeout(barraTimer);
  if (emCurso > 0) {
    // só aparece se demorar mais de 120 ms (evita piscar em ações instantâneas)
    barraTimer = window.setTimeout(() => barra().classList.add('on'), 120);
  } else {
    document.querySelector('.barra-carga')?.classList.remove('on');
  }
}

/** Corre uma tarefa com a barra de carregamento do topo. */
export async function aCarregar<T>(fn: () => Promise<T>): Promise<T> {
  carregamento(true);
  try {
    return await fn();
  } finally {
    carregamento(false);
  }
}

function marcarOcupado(el: HTMLElement, on: boolean): void {
  el.classList.toggle('a-carregar', on);
  if (on) el.setAttribute('aria-busy', 'true');
  else el.removeAttribute('aria-busy');
  if (el instanceof HTMLButtonElement || el instanceof HTMLSelectElement || el instanceof HTMLInputElement) {
    if (on) {
      el.dataset.antesOcupado = el.disabled ? '1' : '';
      el.disabled = true;
    } else {
      if (!el.dataset.antesOcupado) el.disabled = false;
      delete el.dataset.antesOcupado;
    }
  }
}

/**
 * Mostra o botão (ou outro elemento) "a carregar" enquanto a tarefa corre: spinner, desativado,
 * e a barra do topo. A tarefa começa logo (mantém o "gesto do utilizador" para copiar/partilhar).
 */
export async function ocupado<T>(el: Element | null | undefined, fn: () => Promise<T>): Promise<T> {
  const alvo = el instanceof HTMLElement && !el.classList.contains('a-carregar') ? el : null;
  const p = fn();
  if (alvo) marcarOcupado(alvo, true);
  carregamento(true);
  try {
    return await p;
  } finally {
    carregamento(false);
    if (alvo) marcarOcupado(alvo, false);
  }
}

/**
 * Loaders automáticos: um botão que o código desativa logo a seguir a ser clicado (ou o botão de
 * submissão de um formulário) mostra o spinner até voltar a ficar ativo.
 */
export function instalarLoaders(): void {
  let ultimo: { el: HTMLElement; t: number } | null = null;
  const lembrar = (el: Element | null): void => {
    if (el instanceof HTMLButtonElement) ultimo = { el, t: performance.now() };
  };
  document.addEventListener('click', (e) => lembrar((e.target as Element).closest?.('button') ?? null), true);
  document.addEventListener(
    'submit',
    (e) => {
      const f = e.target as HTMLFormElement;
      lembrar((e as SubmitEvent).submitter ?? f.querySelector('button[type="submit"], button:not([type])'));
    },
    true,
  );
  new MutationObserver((muts) => {
    for (const m of muts) {
      const el = m.target;
      if (!(el instanceof HTMLButtonElement) || el.dataset.antesOcupado !== undefined) continue;
      if (el.disabled) {
        if (ultimo?.el === el && performance.now() - ultimo.t < 1500) el.classList.add('a-carregar', 'auto');
      } else if (el.classList.contains('auto')) {
        el.classList.remove('a-carregar', 'auto');
      }
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['disabled'], subtree: true });
}

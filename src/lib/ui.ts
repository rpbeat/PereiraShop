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
      return 'Demasiadas tentativas. Tente novamente daqui a pouco.';
    case 'auth/network-request-failed':
      return 'Sem ligação à internet.';
    default:
      console.error(err);
      return 'Ocorreu um erro. Tente novamente.';
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

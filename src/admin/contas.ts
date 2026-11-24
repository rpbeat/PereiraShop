import { sendPasswordResetEmail } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, type Timestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { Order } from '../lib/types';
import { esc, fmtDate, toast } from '../lib/ui';
import { waLink } from '../lib/whatsapp';

/**
 * Contas de clientes (coleção users) e bloqueios (coleção bloqueados/{uid}).
 * Uma conta bloqueada continua a conseguir entrar, mas as regras do Firestore
 * deixam de lhe dar o catálogo e de aceitar encomendas novas; a loja mostra "Conta bloqueada".
 */

interface Bloqueio {
  motivo: string;
  em: Timestamp | null;
  por: string;
}

interface Conta {
  uid: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  createdAt: Timestamp | null;
  bloqueio: Bloqueio | null;
}

type Filtro = 'todas' | 'ativas' | 'bloqueadas';

interface Ctx {
  app: HTMLElement;
  orders: () => Order[];
  /** Abre a página de encomendas já filtrada por este texto. */
  verEncomendas: (termo: string) => void;
}

let contas: Conta[] | null = null;
let filtro: Filtro = 'todas';
let pesquisa = '';
let aCarregar: Promise<void> | null = null;

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const norm = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

async function carregar(): Promise<void> {
  const [uSnap, bSnap] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'bloqueados'))]);
  const bloq = new Map(
    bSnap.docs.map((d) => {
      const x = d.data();
      return [d.id, { motivo: s(x.motivo), em: x.em ?? null, por: s(x.por), email: s(x.email), name: s(x.name) }] as const;
    }),
  );
  const lista: Conta[] = uSnap.docs.map((d) => {
    const x = d.data();
    const b = bloq.get(d.id);
    return {
      uid: d.id,
      name: s(x.name),
      email: s(x.email),
      phone: s(x.phone),
      city: s(x.city),
      createdAt: x.createdAt ?? null,
      bloqueio: b ? { motivo: b.motivo, em: b.em, por: b.por } : null,
    };
  });
  // bloqueios de contas sem perfil (raro) também aparecem, para se poderem desbloquear
  bloq.forEach((b, uid) => {
    if (!lista.some((c) => c.uid === uid))
      lista.push({ uid, name: b.name, email: b.email, phone: '', city: '', createdAt: null, bloqueio: { motivo: b.motivo, em: b.em, por: b.por } });
  });
  lista.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0) || a.name.localeCompare(b.name, 'pt'));
  contas = lista;
}

export function renderContas(ctx: Ctx, recarregar = false): void {
  const { app } = ctx;
  if (!contas || recarregar) {
    app.innerHTML = '<p class="empty">A carregar contas…</p>';
    aCarregar ??= carregar().finally(() => (aCarregar = null));
    aCarregar
      .then(() => {
        if (location.hash.startsWith('#/contas')) renderContas(ctx);
      })
      .catch((err) => {
        console.error(err);
        app.innerHTML = '<p class="empty">Não foi possível carregar as contas. Confirma que as regras do Firestore foram publicadas.</p>';
      });
    return;
  }

  const n = (f: Filtro): number => contas!.filter((c) => passa(c, f)).length;
  app.innerHTML = `
    <section>
      <div class="toolbar">
        <h1>Contas</h1>
        <input id="csearch" type="search" placeholder="Nome, email, telefone…" value="${esc(pesquisa)}">
      </div>
      <div class="chips">
        ${(
          [
            ['todas', 'Todas'],
            ['ativas', 'Ativas'],
            ['bloqueadas', 'Bloqueadas'],
          ] as [Filtro, string][]
        )
          .map(([k, l]) => `<button class="chip ${filtro === k ? 'on' : ''}" data-cfiltro="${k}">${l} <span class="count">${n(k)}</span></button>`)
          .join('')}
        <button class="btn ghost small" id="crecarregar">Atualizar</button>
      </div>
      <p class="muted small">Uma conta bloqueada continua a conseguir entrar, mas deixa de ver o catálogo e de poder encomendar.</p>
      <div id="clist" class="contas"></div>
    </section>`;

  app.querySelectorAll<HTMLButtonElement>('[data-cfiltro]').forEach((b) =>
    b.addEventListener('click', () => {
      filtro = b.dataset.cfiltro as Filtro;
      renderContas(ctx);
    }),
  );
  app.querySelector('#crecarregar')!.addEventListener('click', () => renderContas(ctx, true));
  app.querySelector<HTMLInputElement>('#csearch')!.addEventListener('input', (e) => {
    pesquisa = (e.target as HTMLInputElement).value;
    desenhar(ctx);
  });
  app.querySelector('#clist')!.addEventListener('click', (e) => void acao(ctx, e));
  desenhar(ctx);
}

function passa(c: Conta, f: Filtro): boolean {
  return f === 'todas' || (f === 'bloqueadas' ? !!c.bloqueio : !c.bloqueio);
}

function desenhar(ctx: Ctx): void {
  const list = ctx.app.querySelector('#clist');
  if (!list || !contas) return;
  const q = norm(pesquisa.trim());
  const porUid = new Map<string, number>();
  ctx.orders().forEach((o) => porUid.set(o.uid, (porUid.get(o.uid) ?? 0) + 1));
  const eu = auth.currentUser?.uid;
  const vis = contas.filter((c) => passa(c, filtro) && (!q || norm(`${c.name} ${c.email} ${c.phone} ${c.city}`).includes(q)));
  list.innerHTML = vis.length
    ? vis
        .map((c) => {
          const nEnc = porUid.get(c.uid) ?? 0;
          const wa = c.phone ? waLink(c.phone) : '';
          return `
        <div class="card conta ${c.bloqueio ? 'bloqueada' : ''}">
          <div class="conta-info">
            <div class="conta-nome">
              <b>${esc(c.name || '(sem nome)')}</b>
              ${c.bloqueio ? '<span class="tag err">Bloqueada</span>' : ''}
              ${c.uid === eu ? '<span class="tag">A tua conta</span>' : ''}
            </div>
            <div class="muted small">
              ${esc(c.email || '(sem email)')}
              ${c.phone ? ` · ${esc(c.phone)}${wa ? ` <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}` : ''}
              ${c.city ? ` · ${esc(c.city)}` : ''}
            </div>
            <div class="muted small">
              Registada: ${fmtDate(c.createdAt)} ·
              ${nEnc ? `<a href="#" data-cenc="${esc(c.email || c.name)}">${nEnc} ${nEnc === 1 ? 'encomenda' : 'encomendas'}</a>` : 'sem encomendas'}
            </div>
            ${
              c.bloqueio
                ? `<div class="small conta-motivo">Bloqueada${c.bloqueio.em ? ` em ${fmtDate(c.bloqueio.em)}` : ''}${c.bloqueio.por ? ` por ${esc(c.bloqueio.por)}` : ''}${
                    c.bloqueio.motivo ? ` — ${esc(c.bloqueio.motivo)}` : ''
                  }</div>`
                : ''
            }
          </div>
          <div class="btns">
            ${c.email ? `<button class="btn ghost small" data-creset="${c.uid}">Enviar reposição de palavra-passe</button>` : ''}
            ${
              c.uid === eu
                ? ''
                : c.bloqueio
                  ? `<button class="btn small" data-cdesbloquear="${c.uid}">Desbloquear</button>`
                  : `<button class="btn danger small" data-cbloquear="${c.uid}">Bloquear</button>`
            }
          </div>
        </div>`;
        })
        .join('')
    : '<p class="empty">Sem contas.</p>';
}

async function acao(ctx: Ctx, e: Event): Promise<void> {
  const t = e.target as HTMLElement;
  const enc = t.closest<HTMLElement>('[data-cenc]');
  if (enc) {
    e.preventDefault();
    ctx.verEncomendas(enc.dataset.cenc ?? '');
    return;
  }
  const btn = t.closest<HTMLButtonElement>('[data-cbloquear],[data-cdesbloquear],[data-creset]');
  if (!btn || !contas) return;
  const uid = btn.dataset.cbloquear ?? btn.dataset.cdesbloquear ?? btn.dataset.creset ?? '';
  const c = contas.find((x) => x.uid === uid);
  if (!c) return;
  const nome = c.name || c.email || uid;

  if (btn.dataset.creset !== undefined) {
    if (!confirm(`Enviar a ${c.email} um email para definir uma nova palavra-passe?`)) return;
    btn.disabled = true;
    try {
      await sendPasswordResetEmail(auth, c.email);
      toast('Email de reposição enviado.');
    } catch (err) {
      console.error(err);
      toast('Não foi possível enviar o email.', 'err');
    } finally {
      btn.disabled = false;
    }
    return;
  }

  btn.disabled = true;
  try {
    if (btn.dataset.cbloquear !== undefined) {
      const motivo = prompt(`Bloquear a conta de ${nome}?\nDeixa de ver o catálogo e de poder encomendar.\n\nMotivo (opcional, para registo):`, '');
      if (motivo === null) {
        btn.disabled = false;
        return;
      }
      const por = auth.currentUser?.email ?? '';
      await setDoc(doc(db, 'bloqueados', uid), { motivo: motivo.trim(), email: c.email, name: c.name, por, em: serverTimestamp() });
      c.bloqueio = { motivo: motivo.trim(), em: null, por };
      toast(`Conta de ${nome} bloqueada.`);
    } else {
      if (!confirm(`Desbloquear a conta de ${nome}?`)) {
        btn.disabled = false;
        return;
      }
      await deleteDoc(doc(db, 'bloqueados', uid));
      c.bloqueio = null;
      toast(`Conta de ${nome} desbloqueada.`);
    }
    renderContas(ctx);
  } catch (err) {
    console.error(err);
    toast('Não foi possível alterar a conta.', 'err');
    btn.disabled = false;
  }
}

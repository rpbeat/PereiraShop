import '../styles.css';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { logoHtml } from '../lib/logo';
import { auth, db, SHOP_NAME } from '../lib/firebase';
import { criarMiniatura, deleteByUrl, uploadImage } from '../lib/storage';
import { publicarIndice } from '../lib/catalogo';
import { detetarPrincipal, prepararDetetor } from '../lib/fotoPrincipal';
import { copiarConfirmacao, partilharConfirmacao } from '../lib/confirmacao';
import { renderImport } from './import';
import { renderContas } from './contas';
import { caminhoDe, caminhoTexto, interpretar } from '../lib/nomes';
import {
  SIZES_ADULT,
  SIZES_KIDS,
  STATUSES,
  STATUS_LABELS,
  toOrder,
  toPatch,
  toProduct,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Patch,
  type Product,
} from '../lib/types';
import { authError, esc, fmtDate, orderCode, toast } from '../lib/ui';
import { copyImage, copyImageWithText, copyText, itemMessage, orderSummary, partilhar, podePartilhar, waLink } from '../lib/whatsapp';

type OrderFilter = OrderStatus | 'ativas' | 'todas';

const app = document.getElementById('app') as HTMLElement;
const nav = document.getElementById('nav') as HTMLElement;
(document.getElementById('brand') as HTMLElement).innerHTML = logoHtml(SHOP_NAME, 'Backoffice');
document.title = `${SHOP_NAME} · Backoffice`;

let orders: Order[] = [];
let products: Product[] = [];
let patches: Patch[] = [];
let unsubOrders: Unsubscribe | null = null;
let view = '';
let orderFilter: OrderFilter = 'ativas';
let orderSearch = '';
let queueIncludePending = false;
let productSearch = '';
/** Filtro da página Artigos: categoria escolhida (por níveis) e estado. */
let prodPath: string[] = [];
let prodEstado: 'todos' | 'visiveis' | 'ocultos' = 'todos';

const ACTIVE: OrderStatus[] = ['pendente', 'paga', 'encomendada', 'enviada'];
const PARTILHA = podePartilhar();

/* ---------- arranque ---------- */

onAuthStateChanged(auth, async (u) => {
  unsubOrders?.();
  unsubOrders = null;
  if (!u) {
    nav.innerHTML = '';
    renderLogin();
    return;
  }
  app.innerHTML = '<p class="empty">A verificar permissões…</p>';
  let isAdmin = false;
  try {
    isAdmin = (await getDoc(doc(db, 'admins', u.uid))).exists();
  } catch {
    isAdmin = false;
  }
  if (!isAdmin) {
    nav.innerHTML = '';
    app.innerHTML = `
      <section class="card auth">
        <h1>Sem acesso</h1>
        <p>A conta <b>${esc(u.email)}</b> não tem permissões de administração.</p>
        <p class="muted small">Para dar acesso, crie no Firestore o documento <code>admins/${esc(u.uid)}</code>.</p>
        <button class="btn" id="out">Sair</button>
      </section>`;
    app.querySelector('#out')!.addEventListener('click', () => void signOut(auth));
    return;
  }

  try {
    await Promise.all([loadProducts(), loadPatches()]);
    dadosProntos = true; // só publica o índice com artigos E patches carregados
    agendarPublicacao();
  } catch (err) {
    console.error(err);
    toast('Erro a carregar artigos/patches.', 'err');
  }

  unsubOrders = onSnapshot(
    query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(500)),
    (snap) => {
      orders = snap.docs.map((d) => toOrder(d.id, d.data()));
      renderNav();
      if (view === 'encomendas') drawOrders();
      if (view === 'fila') renderQueue();
    },
    (err) => {
      console.error(err);
      toast('Erro a carregar encomendas.', 'err');
    },
  );
  renderNav();
  route();
});

window.addEventListener('hashchange', () => {
  if (auth.currentUser && nav.innerHTML) route();
});

async function loadProducts(): Promise<void> {
  const snap = await getDocs(collection(db, 'products'));
  products = snap.docs
    .map((d) => toProduct(d.id, d.data()))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  agendarPublicacao();
}

async function loadPatches(): Promise<void> {
  const snap = await getDocs(collection(db, 'patches'));
  patches = snap.docs
    .map((d) => toPatch(d.id, d.data()))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt'));
  agendarPublicacao();
}

/* ---------- índice do catálogo da loja ---------- */
// A loja lê o catálogo de um índice (poucas leituras) em vez de ler artigo a artigo.
// Sempre que artigos ou patches mudam, o índice é republicado (só se o conteúdo mudou).

let publicarTimer = 0;
let dadosProntos = false;
let ultimaPublicacao = '';
let publicando: Promise<void> | null = null;

function agendarPublicacao(): void {
  if (!dadosProntos) return;
  clearTimeout(publicarTimer);
  publicarTimer = window.setTimeout(() => void publicarAgora(false), 1500);
}

async function publicarAgora(forcar: boolean): Promise<void> {
  if (!dadosProntos) return;
  if (publicando) await publicando;
  publicando = (async () => {
    try {
      const escreveu = await publicarIndice(db, products, patches, forcar);
      ultimaPublicacao = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      if (escreveu) toast('Catálogo da loja atualizado.');
    } catch (err) {
      console.error(err);
      toast('Não foi possível atualizar o catálogo da loja. Use "Publicar catálogo" em Artigos.', 'err');
    } finally {
      publicando = null;
      const est = document.querySelector('#pubEstado');
      if (est) est.textContent = ultimaPublicacao ? `Loja sincronizada às ${ultimaPublicacao}` : '';
    }
  })();
  await publicando;
}

function queueItems(): { o: Order; i: OrderItem; idx: number }[] {
  const statuses: OrderStatus[] = queueIncludePending ? ['pendente', 'paga'] : ['paga'];
  return orders
    .filter((o) => statuses.includes(o.status))
    .slice()
    .reverse() // mais antigas primeiro
    .flatMap((o) => o.items.map((i, idx) => ({ o, i, idx })).filter((x) => !x.i.supplierSent));
}

function renderNav(): void {
  const pending = orders.filter((o) => o.status === 'pendente').length;
  const queue = queueItems().length;
  nav.innerHTML = `
    <a href="#/encomendas">Encomendas${pending ? ` <span class="badge">${pending}</span>` : ''}</a>
    <a href="#/fila">Fila fornecedor${queue ? ` <span class="badge">${queue}</span>` : ''}</a>
    <a href="#/artigos">Artigos</a>
    <a href="#/importar">Importar</a>
    <a href="#/patches">Patches</a>
    <a href="#/contas">Contas</a>
    <a href="#" id="logout">Sair</a>`;
  nav.querySelector('#logout')!.addEventListener('click', (e) => {
    e.preventDefault();
    void signOut(auth);
  });
  highlightNav();
}

function highlightNav(): void {
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${view}`));
}

function route(): void {
  const [page = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  view = page || 'encomendas';
  highlightNav();
  window.scrollTo(0, 0);
  switch (view) {
    case 'encomendas':
      renderOrders();
      break;
    case 'fila':
      renderQueue();
      break;
    case 'artigos':
      if (arg) renderProductForm(decodeURIComponent(arg));
      else renderProducts();
      break;
    case 'patches':
      renderPatches(decodeURIComponent(arg));
      break;
    case 'contas':
      renderContas({
        app,
        orders: () => orders,
        verEncomendas: (termo) => {
          orderSearch = termo;
          orderFilter = 'todas';
          location.hash = '#/encomendas';
        },
      });
      break;
    case 'importar':
      renderImport({ app, products: () => products, patches: () => patches, reloadProducts: loadProducts });
      break;
    default:
      location.hash = '#/encomendas';
  }
}

/* ---------- login ---------- */

function renderLogin(): void {
  app.innerHTML = `
    <section class="card auth">
      <h1>Backoffice</h1>
      <form id="login" class="form">
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <label>Palavra-passe<input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn primary big" type="submit">Entrar</button>
      </form>
      <p class="auth-links"><a href="#" id="reset">Esqueci-me da palavra-passe</a></p>
    </section>`;
  const form = app.querySelector<HTMLFormElement>('#login')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await signInWithEmailAndPassword(auth, String(fd.get('email')).trim(), String(fd.get('password')));
    } catch (err) {
      toast(authError(err), 'err');
    }
  });
  app.querySelector('#reset')!.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = String(new FormData(form).get('email') ?? '').trim();
    if (!email) {
      toast('Escreva primeiro o email.', 'err');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      toast('Link enviado para o email.');
    } catch (err) {
      toast(authError(err), 'err');
    }
  });
}

/* ---------- ações globais (delegação) ---------- */

app.addEventListener('click', async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-copy],[data-summary],[data-sent],[data-copy-all],[data-conf]');
  if (!t) return;

  if (t.dataset.copyAll !== undefined) {
    const text = queueItems()
      .map(({ o, i }) => `#${orderCode(o.id)} — ${i.title}\n${itemMessage(i)}`)
      .join('\n\n');
    await safeCopy(() => copyText(text), 'Textos copiados.');
    return;
  }

  const o = orders.find((x) => x.id === (t.dataset.o ?? t.dataset.summary ?? t.dataset.sent));
  if (!o) return;

  if (t.dataset.summary) {
    await safeCopy(() => copyText(orderSummary(o)), 'Resumo copiado.');
    return;
  }

  if (t.dataset.conf === 'copiar') {
    await safeCopy(() => copiarConfirmacao(o, SHOP_NAME), 'Confirmação copiada — cole na conversa do cliente no WhatsApp.');
    return;
  }
  if (t.dataset.conf === 'partilhar') {
    try {
      const r = await partilharConfirmacao(o, SHOP_NAME);
      if (r === 'repetir') toast('Imagem preparada — toque outra vez em "Partilhar confirmação".');
    } catch (err) {
      console.error(err);
      toast('Não foi possível partilhar. Use "Copiar confirmação".', 'err');
    }
    return;
  }

  const idx = Number(t.dataset.i);
  const item = o.items[idx];
  if (!item) return;

  if (t.dataset.sent) {
    await toggleSent(o, idx);
    return;
  }

  switch (t.dataset.copy) {
    case 'txt':
      await safeCopy(() => copyText(itemMessage(item)), 'Texto copiado — cole no WhatsApp.');
      break;
    case 'img':
      await safeCopy(() => copyImage(item.imageUrl), 'Imagem copiada — cole no WhatsApp.');
      break;
    case 'composta':
      await safeCopy(() => copyImageWithText(item.imageUrl, itemMessage(item)), 'Imagem com o texto copiada — cole no WhatsApp.');
      break;
    case 'partilhar':
      try {
        const r = await partilhar(item.imageUrl, itemMessage(item), item.title);
        if (r === 'repetir') toast('Imagem preparada — toque outra vez em "Partilhar".');
      } catch (err) {
        console.error(err);
        toast('Não foi possível partilhar. Use "Copiar imagem com texto".', 'err');
      }
      break;
  }
});

app.addEventListener('change', async (e) => {
  const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-status]');
  if (!sel) return;
  try {
    await updateDoc(doc(db, 'orders', sel.dataset.status!), { status: sel.value, updatedAt: serverTimestamp() });
    toast(`Estado alterado para "${STATUS_LABELS[sel.value as OrderStatus]}".`);
  } catch (err) {
    console.error(err);
    toast('Não foi possível alterar o estado.', 'err');
  }
});

async function safeCopy(fn: () => Promise<void>, ok: string): Promise<void> {
  try {
    await fn();
    toast(ok);
  } catch (err) {
    console.error(err);
    toast('Não foi possível copiar. Se for a imagem, confirme a configuração CORS do Storage (ver README).', 'err');
  }
}

async function toggleSent(o: Order, idx: number): Promise<void> {
  const items = o.items.map((it, k) => (k === idx ? { ...it, supplierSent: !it.supplierSent } : it));
  const patch: Record<string, unknown> = { items, updatedAt: serverTimestamp() };
  const allSent = items.every((i) => i.supplierSent);
  if (allSent && (o.status === 'pendente' || o.status === 'paga')) patch.status = 'encomendada';
  try {
    await updateDoc(doc(db, 'orders', o.id), patch);
    toast(allSent && patch.status ? `Encomenda #${orderCode(o.id)} passou a "Encomendada ao fornecedor".` : 'Atualizado.');
  } catch (err) {
    console.error(err);
    toast('Não foi possível atualizar.', 'err');
  }
}

/* ---------- encomendas ---------- */

function matchesFilter(o: Order): boolean {
  if (orderFilter === 'todas') return true;
  if (orderFilter === 'ativas') return ACTIVE.includes(o.status);
  return o.status === orderFilter;
}

function renderOrders(): void {
  const count = (f: OrderFilter): number => {
    const prev = orderFilter;
    orderFilter = f;
    const n = orders.filter(matchesFilter).length;
    orderFilter = prev;
    return n;
  };
  const filters: [OrderFilter, string][] = [
    ['ativas', 'Ativas'],
    ...STATUSES.map((s): [OrderFilter, string] => [s, STATUS_LABELS[s]]),
    ['todas', 'Todas'],
  ];
  app.innerHTML = `
    <section>
      <div class="toolbar">
        <h1>Encomendas</h1>
        <input id="osearch" type="search" placeholder="Código, nome, telefone, artigo…" value="${esc(orderSearch)}">
      </div>
      <div class="chips">${filters
        .map(([k, l]) => `<button class="chip ${orderFilter === k ? 'on' : ''}" data-filter="${k}">${l} <span class="count">${count(k)}</span></button>`)
        .join('')}</div>
      <div id="olist" class="orders"></div>
    </section>`;
  app.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      orderFilter = b.dataset.filter as OrderFilter;
      renderOrders();
    }),
  );
  app.querySelector<HTMLInputElement>('#osearch')!.addEventListener('input', (e) => {
    orderSearch = (e.target as HTMLInputElement).value;
    drawOrders();
  });
  drawOrders();
}

function drawOrders(): void {
  const list = app.querySelector('#olist');
  if (!list) return;
  const q = orderSearch.trim().toLowerCase();
  const shown = orders.filter(
    (o) =>
      matchesFilter(o) &&
      (!q ||
        [orderCode(o.id), o.customer.name, o.customer.phone, o.email, ...o.items.map((i) => `${i.title} ${i.name} ${i.number}`)]
          .join(' ')
          .toLowerCase()
          .includes(q)),
  );
  list.innerHTML = shown.length ? shown.map(orderCard).join('') : '<p class="empty">Sem encomendas.</p>';
}

function orderCard(o: Order): string {
  const c = o.customer;
  const wa = waLink(c.phone);
  const addr = [c.address, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return `
    <article class="card order">
      <header class="order-head">
        <b>#${orderCode(o.id)}</b>
        <span class="muted">${fmtDate(o.createdAt)}</span>
        <select data-status="${o.id}" class="status-select s-${o.status}" aria-label="Estado">
          ${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </header>
      <div class="customer">
        <b>${esc(c.name)}</b>
        <span>${esc(c.phone)}${wa ? ` · <a href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</span>
        <span>${esc(o.email)}</span>
        ${addr ? `<span class="muted">${esc(addr)}</span>` : ''}
      </div>
      ${o.notes ? `<p class="note">${esc(o.notes)}</p>` : ''}
      <div class="oitems">${o.items.map((i, idx) => itemBlock(o, i, idx)).join('')}</div>
      <footer class="order-foot">
        <button class="btn ghost small" data-summary="${o.id}">Copiar resumo (texto)</button>
        ${PARTILHA ? `<button class="btn small" data-conf="partilhar" data-o="${o.id}">Partilhar confirmação…</button>` : ''}
        <button class="btn primary small" data-conf="copiar" data-o="${o.id}" title="Imagem com toda a encomenda para enviar ao cliente">Copiar confirmação (imagem)</button>
      </footer>
    </article>`;
}

/* ---------- edição de um artigo da encomenda ---------- */

/** Artigo em edição (o rascunho fica em memória: a lista pode ser redesenhada por atualizações em tempo real). */
let edicao: { key: string; v: OrderItem } | null = null;
const chaveItem = (o: Order, idx: number): string => `${o.id}:${idx}`;

function redesenharVista(): void {
  if (view === 'encomendas') drawOrders();
  else if (view === 'fila') renderQueue();
}

function editorItem(o: Order, idx: number, showOrder: boolean): string {
  const v = edicao!.v;
  const prod = products.find((p) => p.id === v.productId);
  const tamanhos = [...new Set([...(prod?.sizes.length ? prod.sizes : [...SIZES_ADULT, ...SIZES_KIDS]), v.size].filter(Boolean))];
  const nomesPatch = [...new Set([...patches.filter((p) => p.active || v.patches.includes(p.name)).map((p) => p.name), ...v.patches])];
  return `
    <div class="oitem editing" data-edit-key="${chaveItem(o, idx)}">
      ${v.imageUrl ? `<img src="${esc(v.imageUrl)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="grow item-edit">
        <div class="oitem-title">
          ${showOrder ? `<span class="muted">#${orderCode(o.id)} · ${esc(o.customer.name)}</span>` : ''}
          <b>${esc(v.title)}</b> <span class="tag warn">A editar</span>
        </div>
        <div class="edit-grid">
          <label>Tamanho<select data-f="size">${tamanhos.map((t) => `<option ${t === v.size ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Nome<input data-f="name" value="${esc(v.name)}" maxlength="15" class="upper" autocomplete="off"></label>
          <label>Número<input data-f="number" value="${esc(v.number)}" inputmode="numeric" maxlength="2" autocomplete="off"></label>
          <label>Quantidade<input data-f="qty" type="number" min="1" max="20" value="${v.qty}"></label>
        </div>
        ${nomesPatch.length ? `<div class="patches-edit">${nomesPatch
          .map((n) => `<label class="check"><input type="checkbox" data-patch="${esc(n)}" ${v.patches.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`)
          .join('')}</div>` : ''}
        <label class="obs">Observações<input data-f="notes" value="${esc(v.notes)}" maxlength="300"></label>
        <pre class="msg" data-preview>${esc(itemMessage(v))}</pre>
        <div class="btns">
          <button class="btn primary small" data-edit-save>Guardar alterações</button>
          <button class="btn ghost small" data-edit-cancel>Cancelar</button>
        </div>
      </div>
    </div>`;
}

app.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const abrir = t.closest<HTMLElement>('[data-edit]');
  if (abrir) {
    const o = orders.find((x) => x.id === abrir.dataset.o);
    const idx = Number(abrir.dataset.i);
    const item = o?.items[idx];
    if (!o || !item) return;
    edicao = { key: chaveItem(o, idx), v: { ...item, patches: [...item.patches] } };
    redesenharVista();
    app.querySelector<HTMLInputElement>(`[data-edit-key="${edicao.key}"] [data-f="name"]`)?.focus();
    return;
  }
  if (t.closest('[data-edit-cancel]')) {
    edicao = null;
    redesenharVista();
    return;
  }
  const guardar = t.closest<HTMLButtonElement>('[data-edit-save]');
  if (guardar && edicao) {
    const [oid, si] = edicao.key.split(':');
    const o = orders.find((x) => x.id === oid);
    const idx = Number(si);
    const antigo = o?.items[idx];
    if (!o || !antigo) return;
    const v: OrderItem = {
      ...edicao.v,
      name: edicao.v.name.trim().toUpperCase(),
      number: edicao.v.number.replace(/\D/g, '').slice(0, 2),
      qty: Math.min(20, Math.max(1, Math.round(edicao.v.qty) || 1)),
      notes: edicao.v.notes.trim(),
    };
    const mudou = itemMessage(v) !== itemMessage(antigo) || v.notes !== antigo.notes;
    if (!mudou) {
      edicao = null;
      redesenharVista();
      return;
    }
    if (antigo.supplierSent) {
      if (!confirm('Este artigo já foi enviado ao fornecedor.\nGuardar a correção e voltar a pô-lo na Fila do fornecedor para reenviar?')) return;
      v.supplierSent = false;
    }
    guardar.disabled = true;
    try {
      const items = o.items.map((it, k) => (k === idx ? v : it));
      await updateDoc(doc(db, 'orders', o.id), { items, updatedAt: serverTimestamp() });
      edicao = null;
      toast('Artigo da encomenda corrigido.');
      redesenharVista();
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar a correção.', 'err');
      guardar.disabled = false;
    }
  }
});

// atualiza o rascunho e a pré-visualização da mensagem enquanto se escreve
app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (!edicao || !el.closest('.item-edit')) return;
  const f = el.dataset.f as keyof OrderItem | undefined;
  if (f === 'name') {
    const pos = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(pos, pos);
  }
  if (f === 'number') el.value = el.value.replace(/\D/g, '').slice(0, 2);
  if (f === 'qty') edicao.v.qty = Number(el.value) || 1;
  else if (f === 'size' || f === 'name' || f === 'number' || f === 'notes') edicao.v[f] = el.value;
  if (el.dataset.patch !== undefined) {
    const n = el.dataset.patch;
    edicao.v.patches = el.checked ? [...edicao.v.patches.filter((x) => x !== n), n] : edicao.v.patches.filter((x) => x !== n);
  }
  const pre = el.closest('.item-edit')?.querySelector('[data-preview]');
  if (pre) pre.textContent = itemMessage(edicao.v);
});
app.addEventListener('change', (e) => {
  const el = e.target as HTMLElement;
  if (edicao && el.closest('.item-edit') && (el.matches('select[data-f]') || el.matches('[data-patch]'))) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

function itemBlock(o: Order, i: OrderItem, idx: number, showOrder = false): string {
  if (edicao?.key === chaveItem(o, idx)) return editorItem(o, idx, showOrder);
  const a = `data-o="${o.id}" data-i="${idx}"`;
  return `
    <div class="oitem ${i.supplierSent ? 'sent' : ''}">
      ${i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="grow">
        <div class="oitem-title">
          ${showOrder ? `<span class="muted">#${orderCode(o.id)} · ${esc(o.customer.name)}</span>` : ''}
          <b>${esc(i.title)}</b>
          ${i.supplierSent ? '<span class="tag ok">Enviado ao fornecedor</span>' : ''}
        </div>
        <pre class="msg">${esc(itemMessage(i))}</pre>
        ${i.notes ? `<p class="muted small">Obs. do cliente: ${esc(i.notes)}</p>` : ''}
        <div class="btns">
          <button class="btn primary small" data-copy="composta" ${a} title="Uma só imagem: a foto com o tamanho, nome e número por baixo">Copiar imagem com texto</button>
          ${PARTILHA ? `<button class="btn small" data-copy="partilhar" ${a} title="Abre a partilha do sistema: no WhatsApp vai a foto com o texto como legenda">Partilhar…</button>` : ''}
          <button class="btn ghost small" data-copy="img" ${a}>Só imagem</button>
          <button class="btn ghost small" data-copy="txt" ${a}>Só texto</button>
          <button class="btn ghost small" data-sent="${o.id}" data-i="${idx}">${i.supplierSent ? 'Desmarcar' : 'Marcar como enviado'}</button>
          <button class="btn ghost small" data-edit ${a} title="Corrigir tamanho, nome, número, patches ou quantidade">Editar</button>
        </div>
      </div>
    </div>`;
}

/* ---------- fila do fornecedor ---------- */

function renderQueue(): void {
  const items = queueItems();
  app.innerHTML = `
    <section>
      <div class="toolbar">
        <h1>Fila do fornecedor</h1>
        ${items.length ? '<button class="btn ghost" data-copy-all>Copiar todos os textos</button>' : ''}
      </div>
      <p class="muted">Artigos de encomendas <b>pagas</b> ainda não enviados ao fornecedor, por ordem de chegada.
        Copie, cole no WhatsApp do fornecedor e marque como enviado. Quando todos os artigos de uma encomenda
        estão enviados, a encomenda passa a "Encomendada ao fornecedor".</p>
      <label class="check"><input type="checkbox" id="incPending" ${queueIncludePending ? 'checked' : ''}> Incluir encomendas pendentes de pagamento</label>
      <div class="oitems queue">${
        items.length ? items.map(({ o, i, idx }) => itemBlock(o, i, idx, true)).join('') : '<p class="empty">Nada por enviar ao fornecedor.</p>'
      }</div>
    </section>`;
  app.querySelector<HTMLInputElement>('#incPending')!.addEventListener('change', (e) => {
    queueIncludePending = (e.target as HTMLInputElement).checked;
    renderNav();
    renderQueue();
  });
}

/* ---------- artigos ---------- */

function renderProducts(): void {
  app.innerHTML = `
    <section>
      <div class="toolbar">
        <h1>Artigos</h1>
        <input id="psearch" type="search" placeholder="Procurar…" value="${esc(productSearch)}">
        <button class="btn ghost" id="reint" title="Volta a traduzir títulos e categorias a partir do nome original do fornecedor">Reinterpretar nomes (PT)</button>
        <a class="btn primary" href="#/artigos/novo">Novo artigo</a>
      </div>
      <div class="pub-bar">
        <span class="muted small" id="pubEstado">${ultimaPublicacao ? `Loja sincronizada às ${ultimaPublicacao}` : ''}</span>
        ${(() => {
          const sem = products.filter((p) => !p.thumb && p.images[0]).length;
          return sem ? `<button class="btn small" id="thumbs" title="Imagens pequenas para a grelha da loja: menos dados para os clientes">Criar miniaturas (${sem})</button>` : '';
        })()}
        <button class="btn small" id="detetar" title="Analisa as fotos dos artigos filtrados e propõe a frente da camisola como foto principal">Detetar fotos principais</button>
        <button class="btn small" id="publicar" title="Volta a gerar o índice que a loja usa para mostrar o catálogo">Publicar catálogo</button>
      </div>
      <div id="pfiltros"></div>
      <div id="detPainel"></div>
      <div id="plist" class="grid"></div>
    </section>`;
  app.querySelector<HTMLInputElement>('#psearch')!.addEventListener('input', (e) => {
    productSearch = (e.target as HTMLInputElement).value;
    drawProducts();
  });
  app.querySelector<HTMLButtonElement>('#reint')!.addEventListener('click', (e) => void reinterpretarTodos(e.currentTarget as HTMLButtonElement));
  app.querySelector<HTMLButtonElement>('#publicar')!.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    await publicarAgora(true);
    b.disabled = false;
  });
  app.querySelector<HTMLButtonElement>('#thumbs')?.addEventListener('click', (e) => void criarMiniaturasEmFalta(e.currentTarget as HTMLButtonElement));
  app.querySelector<HTMLButtonElement>('#detetar')!.addEventListener('click', (e) => void detetarFotosPrincipais(e.currentTarget as HTMLButtonElement));

  // filtros e ações em massa (delegação: o conteúdo é redesenhado)
  const filtros = app.querySelector<HTMLElement>('#pfiltros')!;
  filtros.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-plevel],[data-pestado],[data-bulk]');
    if (!b) return;
    if (b.dataset.plevel !== undefined) {
      const level = Number(b.dataset.plevel);
      const c = b.dataset.cat ?? '';
      prodPath = c ? [...prodPath.slice(0, level), c] : prodPath.slice(0, level);
      drawProducts();
    } else if (b.dataset.pestado) {
      prodEstado = b.dataset.pestado as typeof prodEstado;
      drawProducts();
    } else if (b.dataset.bulk) {
      void mudarVisibilidade(alvoFiltro(), b.dataset.bulk === 'mostrar', b);
    }
  });
  app.querySelector('#plist')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-vis]');
    if (!b) return;
    e.preventDefault();
    const p = products.find((x) => x.id === b.dataset.vis);
    if (p) void mudarVisibilidade([p], !p.active, b);
  });
  drawProducts();
}

const comecaPor = (path: string[], prefixo: string[]): boolean => prefixo.every((c, i) => path[i] === c);
const norm = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Artigos da categoria escolhida e da pesquisa (sem o filtro de estado): é sobre estes que atuam os botões em massa. */
function alvoFiltro(): Product[] {
  const termos = norm(productSearch.trim()).split(/\s+/).filter(Boolean);
  return products.filter((p) => {
    if (!comecaPor(p.categoryPath, prodPath)) return false;
    if (!termos.length) return true;
    const t = norm(`${p.title} ${p.categoryPath.join(' ')} ${p.supplierRef} ${p.sourceTitle}`);
    return termos.every((x) => t.includes(x));
  });
}

/* ---------- deteção da foto principal (frente) ---------- */

interface Proposta { p: Product; indice: number; seguro: boolean; aplicar: boolean }
let detCancelar = false;

async function detetarFotosPrincipais(btn: HTMLButtonElement): Promise<void> {
  const alvo = alvoFiltro().filter((p) => p.images.length > 1);
  const painel = app.querySelector<HTMLElement>('#detPainel');
  if (!painel) return;
  if (!alvo.length) {
    toast('Não há artigos com mais de uma foto neste filtro.');
    return;
  }
  const nFotos = alvo.reduce((n, p) => n + p.images.length, 0);
  const onde = prodPath.length ? `"${caminhoTexto(prodPath)}"` : 'todas as categorias';
  if (!confirm(`Analisar ${alvo.length} artigos (${nFotos} fotos) de ${onde}?\nDemora cerca de ${Math.max(1, Math.round((nFotos * 0.5) / 60))} min. Nada é alterado sem a sua confirmação.`)) return;

  btn.disabled = true;
  detCancelar = false;
  const propostas: Proposta[] = [];
  painel.innerHTML = `<div class="card det-card"><b>Deteção da foto principal</b> <span class="muted" id="detEstado">A preparar…</span>
    <button class="btn small" id="detParar">Parar</button></div>`;
  painel.querySelector('#detParar')!.addEventListener('click', () => (detCancelar = true));
  const estado = (t: string): void => {
    const el = painel.querySelector('#detEstado');
    if (el) el.textContent = t;
  };
  try {
    await prepararDetetor((pct) => estado(`A descarregar o detetor (só na 1.ª vez): ${pct}%`));
    let k = 0;
    for (const p of alvo) {
      if (detCancelar) break;
      estado(`A analisar ${++k}/${alvo.length}: ${p.title}`);
      const r = await detetarPrincipal(p.images);
      if (r.indice > 0 || (r.indice >= 0 && !r.seguro)) propostas.push({ p, indice: r.indice, seguro: r.seguro, aplicar: r.indice > 0 && r.seguro });
    }
  } catch (err) {
    console.error(err);
    estado('Não foi possível usar o detetor de fotos (sem ligação?).');
    btn.disabled = false;
    return;
  }
  btn.disabled = false;
  mostrarPropostas(painel, propostas, alvo.length);
}

function mostrarPropostas(painel: HTMLElement, propostas: Proposta[], analisados: number): void {
  const mudar = propostas.filter((x) => x.indice > 0);
  const linha = (x: Proposta, k: number): string => `
    <div class="det-row ${x.seguro ? '' : 'rever'}">
      <label class="check"><input type="checkbox" data-prop="${k}" ${x.aplicar ? 'checked' : ''} ${x.indice > 0 ? '' : 'disabled'}></label>
      <div class="det-imgs">
        <figure><img src="${esc(x.p.thumb || x.p.images[0]!)}" alt=""><figcaption>Atual</figcaption></figure>
        <span aria-hidden="true">›</span>
        <figure><img src="${esc(x.p.images[x.indice]!)}" alt="" loading="lazy"><figcaption>${x.indice > 0 ? 'Proposta' : 'Mantém'}</figcaption></figure>
      </div>
      <div class="grow"><b>${esc(x.p.title)}</b><div class="muted small">${esc(caminhoTexto(x.p.categoryPath))}</div>
        ${x.seguro ? '' : '<span class="tag warn">Pouca certeza: confirme</span>'}
        <a class="small" href="#/artigos/${encodeURIComponent(x.p.id)}">Abrir artigo</a></div>
    </div>`;
  painel.innerHTML = `
    <div class="card det-card">
      <div class="det-head">
        <div><b>Deteção da foto principal</b>
          <div class="muted small">${analisados} artigos analisados: ${mudar.length} com outra foto proposta, ${propostas.filter((x) => !x.seguro).length} com pouca certeza.</div></div>
        <div class="btns">
          <button class="btn small" id="detFechar">Fechar</button>
          <button class="btn primary small" id="detAplicar" ${mudar.length ? '' : 'disabled'}>Aplicar selecionados</button>
        </div>
      </div>
      ${propostas.length ? `<div class="det-list">${propostas.map(linha).join('')}</div>` : '<p class="muted">Todas as fotos principais já parecem ser a frente.</p>'}
    </div>`;
  painel.querySelector('#detFechar')!.addEventListener('click', () => (painel.innerHTML = ''));
  painel.querySelectorAll<HTMLInputElement>('[data-prop]').forEach((c) =>
    c.addEventListener('change', () => (propostas[Number(c.dataset.prop)]!.aplicar = c.checked)),
  );
  painel.querySelector<HTMLButtonElement>('#detAplicar')!.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const sel = propostas.filter((x) => x.aplicar && x.indice > 0);
    if (!sel.length) return;
    b.disabled = true;
    let ok = 0;
    for (const x of sel) {
      b.textContent = `A aplicar ${ok + 1}/${sel.length}…`;
      try {
        const images = [x.p.images[x.indice]!, ...x.p.images.filter((_, i) => i !== x.indice)];
        let thumb = '';
        try {
          thumb = await criarMiniatura(images[0]!, x.p.id);
        } catch (err) {
          console.error(err);
        }
        await updateDoc(doc(db, 'products', x.p.id), { images, thumb, updatedAt: serverTimestamp() });
        if (x.p.thumb) void deleteByUrl(x.p.thumb);
        x.p.images = images;
        x.p.thumb = thumb;
        ok++;
      } catch (err) {
        console.error(err);
      }
    }
    toast(`${ok} de ${sel.length} fotos principais atualizadas.`, ok === sel.length ? 'ok' : 'err');
    agendarPublicacao();
    painel.innerHTML = '';
    drawProducts();
  });
}

/** Cria as miniaturas que faltam (artigos importados antes desta funcionalidade). */
async function criarMiniaturasEmFalta(btn: HTMLButtonElement): Promise<void> {
  const alvo = products.filter((p) => !p.thumb && p.images[0]);
  if (!alvo.length) return;
  btn.disabled = true;
  let ok = 0;
  for (const p of alvo) {
    btn.textContent = `A criar ${ok + 1}/${alvo.length}…`;
    try {
      const thumb = await criarMiniatura(p.images[0]!, p.id);
      await updateDoc(doc(db, 'products', p.id), { thumb });
      p.thumb = thumb;
      ok++;
    } catch (err) {
      console.error(err);
    }
  }
  toast(ok === alvo.length ? `${ok} miniaturas criadas.` : `${ok} de ${alvo.length} miniaturas criadas (ver consola).`, ok === alvo.length ? 'ok' : 'err');
  agendarPublicacao();
  renderProducts();
}

/** Mostra/oculta vários artigos de uma vez (em lotes de 400 escritas). */
async function mudarVisibilidade(lista: Product[], ativo: boolean, btn?: HTMLButtonElement): Promise<void> {
  const alvo = lista.filter((p) => p.active !== ativo);
  if (!alvo.length) return;
  if (alvo.length > 1) {
    const onde = prodPath.length ? ` de "${caminhoTexto(prodPath)}"` : '';
    if (!confirm(`${ativo ? 'Tornar visíveis' : 'Ocultar'} ${alvo.length} artigos${onde}?`)) return;
  }
  if (btn) btn.disabled = true;
  try {
    for (let i = 0; i < alvo.length; i += 400) {
      const lote = writeBatch(db);
      for (const p of alvo.slice(i, i + 400)) lote.update(doc(db, 'products', p.id), { active: ativo, updatedAt: serverTimestamp() });
      await lote.commit();
      for (const p of alvo.slice(i, i + 400)) p.active = ativo;
    }
    toast(alvo.length === 1 ? (ativo ? 'Artigo visível na loja.' : 'Artigo oculto.') : `${alvo.length} artigos ${ativo ? 'visíveis na loja' : 'ocultos'}.`);
    agendarPublicacao();
  } catch (err) {
    console.error(err);
    toast('Não foi possível alterar a visibilidade.', 'err');
  } finally {
    drawProducts();
  }
}

/** Nome original e pastas de um artigo (para voltar a interpretar). */
function origemDe(p: Product): { titulo: string; pastas: string[] } {
  const partes = p.supplierRef.split('/').filter(Boolean);
  const pastaTitulo = (partes[partes.length - 1] ?? '')
    .replace(/^\d{1,4}_/, '')
    .replace(/\b(\d{2}) (\d{2})\b/g, '$1/$2');
  return { titulo: p.sourceTitle || pastaTitulo || p.title, pastas: partes.slice(0, -1) };
}

async function reinterpretarTodos(btn: HTMLButtonElement): Promise<void> {
  const alvo = products.map((p) => ({ p, o: origemDe(p) })).map(({ p, o }) => ({ p, o, r: interpretar(o.titulo, o.pastas) }))
    .filter(({ p, r }) => r.titulo !== p.title || caminhoTexto(r.categorias) !== caminhoTexto(p.categoryPath));
  if (!alvo.length) {
    toast('Todos os artigos já estão com os nomes e categorias interpretados.');
    return;
  }
  const exemplo = alvo.slice(0, 3).map(({ p, r }) => `• ${p.title}\n   → ${r.titulo}\n   (${caminhoTexto(r.categorias)})`).join('\n');
  if (!confirm(`Atualizar título e categorias de ${alvo.length} artigo(s)?\n\n${exemplo}${alvo.length > 3 ? '\n…' : ''}\n\nAs alterações feitas à mão nesses artigos são substituídas.`)) return;
  btn.disabled = true;
  let ok = 0;
  for (const { p, o, r } of alvo) {
    btn.textContent = `A atualizar ${ok + 1}/${alvo.length}…`;
    try {
      await updateDoc(doc(db, 'products', p.id), {
        title: r.titulo,
        category: r.categorias[0] ?? '',
        categoryPath: r.categorias,
        sourceTitle: o.titulo,
        updatedAt: serverTimestamp(),
      });
      ok++;
    } catch (err) {
      console.error(err);
    }
  }
  await loadProducts();
  toast(`${ok} de ${alvo.length} artigos atualizados.`, ok === alvo.length ? 'ok' : 'err');
  renderProducts();
}

function drawProducts(): void {
  const list = app.querySelector('#plist');
  const filtros = app.querySelector('#pfiltros');
  if (!list || !filtros) return;

  // se a categoria escolhida deixou de existir (ex.: artigos reinterpretados), volta ao topo
  while (prodPath.length && !products.some((p) => comecaPor(p.categoryPath, prodPath))) prodPath = prodPath.slice(0, -1);

  // botões de categoria por nível, com "visíveis/total"
  const linhas: string[] = [];
  for (let nivel = 0; nivel <= prodPath.length && nivel < 4; nivel++) {
    const prefixo = prodPath.slice(0, nivel);
    const daqui = products.filter((p) => comecaPor(p.categoryPath, prefixo));
    const opcoes = [...new Set(daqui.map((p) => p.categoryPath[nivel]).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, 'pt'));
    if (!opcoes.length) continue;
    const conta = (c: string): string => {
      const l = daqui.filter((p) => p.categoryPath[nivel] === c);
      return `${l.filter((p) => p.active).length}/${l.length}`;
    };
    const sel = prodPath[nivel] ?? '';
    linhas.push(`<div class="chips level-${nivel}">${['', ...opcoes]
      .map((c) => `<button class="chip ${c === sel ? 'on' : ''}" data-plevel="${nivel}" data-cat="${esc(c)}">${c ? esc(c) : nivel ? 'Todos' : 'Todas as categorias'}${c ? ` <span class="count">${conta(c)}</span>` : ''}</button>`)
      .join('')}</div>`);
  }
  const semCategoria = products.filter((p) => !p.categoryPath.length).length;

  const alvo = alvoFiltro();
  const vis = alvo.filter((p) => p.active).length;
  const ocu = alvo.length - vis;
  const nome = prodPath.length ? caminhoTexto(prodPath) : 'Todas as categorias';
  filtros.innerHTML = `
    ${linhas.join('')}
    ${semCategoria && !prodPath.length ? `<p class="muted small">${semCategoria} artigo(s) sem categoria.</p>` : ''}
    <div class="card bulk-bar">
      <div class="bulk-info"><b>${esc(nome)}</b><span class="muted">${alvo.length} ${alvo.length === 1 ? 'artigo' : 'artigos'}: ${vis} ${vis === 1 ? 'visível' : 'visíveis'}, ${ocu} ${ocu === 1 ? 'oculto' : 'ocultos'}</span></div>
      <div class="chips estado">
        ${(['todos', 'visiveis', 'ocultos'] as const)
          .map((k) => `<button class="chip ${prodEstado === k ? 'on' : ''}" data-pestado="${k}">${{ todos: 'Todos', visiveis: 'Visíveis', ocultos: 'Ocultos' }[k]}</button>`)
          .join('')}
      </div>
      <div class="btns">
        <button class="btn primary small" data-bulk="mostrar" ${ocu ? '' : 'disabled'}>Tornar visíveis${ocu ? ` (${ocu})` : ''}</button>
        <button class="btn small" data-bulk="ocultar" ${vis ? '' : 'disabled'}>Ocultar${vis ? ` (${vis})` : ''}</button>
      </div>
    </div>`;

  const shown = alvo.filter((p) => (prodEstado === 'todos' ? true : prodEstado === 'visiveis' ? p.active : !p.active));
  list.innerHTML = shown.length
    ? shown
        .map(
          (p) => `
          <div class="card product ${p.active ? '' : 'inactive'}">
            <a href="#/artigos/${encodeURIComponent(p.id)}">
              <div class="img">${p.images[0] ? `<img loading="lazy" src="${esc(p.images[0])}" alt="">` : ''}</div>
              <div class="title">${esc(p.title)}</div>
              <div class="muted small">${esc(caminhoTexto(p.categoryPath))}</div>
              <div class="muted small">${esc(p.sizes.join(' '))}</div>
            </a>
            ${p.active ? '' : '<span class="tag">Oculto</span>'}
            <button class="btn small vis-toggle ${p.active ? '' : 'primary'}" data-vis="${esc(p.id)}">${p.active ? 'Ocultar' : 'Mostrar na loja'}</button>
          </div>`,
        )
        .join('')
    : `<p class="empty">${products.length ? 'Nenhum artigo com estes filtros.' : 'Ainda não há artigos.'}</p>`;
}

function renderProductForm(id: string): void {
  const isNew = id === 'novo';
  const existing = isNew ? undefined : products.find((p) => p.id === id);
  if (!isNew && !existing) {
    app.innerHTML = '<p class="empty">Artigo não encontrado. <a href="#/artigos">Voltar</a></p>';
    return;
  }
  const pid = existing?.id ?? doc(collection(db, 'products')).id;
  const p = existing ?? toProduct(pid, { sizes: ['S', 'M', 'L', 'XL', 'XXL'] });
  let images = [...p.images];
  const removed: string[] = [];
  let uploading = 0;

  const cats = [...new Set(products.flatMap((x) => x.categoryPath.map((_, i) => caminhoTexto(x.categoryPath.slice(0, i + 1)))))].sort((a, b) => a.localeCompare(b, 'pt'));
  const extra = p.sizes.filter((s) => !SIZES_ADULT.includes(s) && !SIZES_KIDS.includes(s));
  const sizeBox = (s: string): string =>
    `<label class="size"><input type="checkbox" name="sizes" value="${esc(s)}" ${p.sizes.includes(s) ? 'checked' : ''}><span>${esc(s)}</span></label>`;

  app.innerHTML = `
    <a href="#/artigos" class="back">← Artigos</a>
    <section class="card narrow-page">
      <h1>${isNew ? 'Novo artigo' : 'Editar artigo'}</h1>
      <form id="pform" class="form">
        <label>Título<input name="title" required value="${esc(p.title)}" placeholder="Benfica 2025/26 Principal"></label>
        <div class="row">
          <label>Categoria <span class="muted">(níveis separados por ›)</span><input name="categoryPath" list="cats" value="${esc(caminhoTexto(p.categoryPath))}" placeholder="Liga Portugal › Sporting › Crianças"></label>
          <label>Referência do fornecedor<input name="supplierRef" value="${esc(p.supplierRef)}" placeholder="Link do álbum ou código"></label>
        </div>
        ${p.sourceTitle ? `<p class="muted small">Nome original: ${esc(p.sourceTitle)} · <a href="#" id="reintUm">voltar a interpretar</a></p>` : ''}
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>

        <fieldset>
          <legend>Imagens</legend>
          <div id="imgs" class="img-edit"></div>
          <p id="upStatus" class="muted small"></p>
          <label class="btn ghost file">Adicionar imagens<input id="files" type="file" accept="image/*" multiple hidden></label>
          <p class="muted small">A primeira imagem é a principal: é a que aparece no catálogo e a que segue para o fornecedor.</p>
        </fieldset>

        <fieldset>
          <legend>Tamanhos</legend>
          <p class="muted small">Adulto</p>
          <div class="sizes">${SIZES_ADULT.map(sizeBox).join('')}</div>
          <p class="muted small">Criança</p>
          <div class="sizes">${SIZES_KIDS.map(sizeBox).join('')}</div>
          <label>Outros tamanhos <span class="muted">(separados por vírgula)</span><input name="extraSizes" value="${esc(extra.join(', '))}"></label>
        </fieldset>

        <fieldset>
          <legend>Personalização</legend>
          <label class="check"><input type="checkbox" name="allowNameNumber" ${p.allowNameNumber ? 'checked' : ''}> Permitir nome e número</label>
          ${
            patches.length
              ? `<p class="muted small">Patches que o cliente pode escolher neste artigo:</p>
                 <div class="patches">${patches
                   .map(
                     (pt) => `<label class="patch"><input type="checkbox" name="patchIds" value="${esc(pt.id)}" ${p.patchIds.includes(pt.id) ? 'checked' : ''}>
                       ${pt.imageUrl ? `<img src="${esc(pt.imageUrl)}" alt="">` : ''}<span>${esc(pt.name)}${pt.active ? '' : ' (inativo)'}</span></label>`,
                   )
                   .join('')}</div>`
              : '<p class="muted small">Ainda não há patches. <a href="#/patches/novo">Criar patch</a></p>'
          }
        </fieldset>

        <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Visível na loja</label>
        <div class="btns">
          <button class="btn primary" type="submit" id="save">Guardar</button>
          ${isNew ? '' : '<button class="btn danger" type="button" id="del">Eliminar</button>'}
        </div>
      </form>
    </section>`;

  const imgsEl = app.querySelector<HTMLElement>('#imgs')!;
  const status = app.querySelector<HTMLElement>('#upStatus')!;
  const saveBtn = app.querySelector<HTMLButtonElement>('#save')!;

  const drawImages = (): void => {
    imgsEl.innerHTML = images.length
      ? images
          .map(
            (u, k) => `
            <div class="img-tile">
              <img src="${esc(u)}" alt="">
              <div class="img-actions">
                ${k === 0 ? '<span class="tag ok">Principal</span>' : `<button type="button" class="btn ghost small" data-main="${k}">Principal</button>`}
                <button type="button" class="btn ghost small" data-rm="${k}">Remover</button>
              </div>
            </div>`,
          )
          .join('')
      : '<p class="muted small">Sem imagens.</p>';
    status.textContent = uploading ? `A carregar ${uploading} imagem(ns)…` : '';
    saveBtn.disabled = uploading > 0;
  };
  drawImages();

  imgsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-main],[data-rm]');
    if (!b) return;
    if (b.dataset.main) {
      const k = Number(b.dataset.main);
      images = [images[k]!, ...images.filter((_, j) => j !== k)];
    } else {
      const k = Number(b.dataset.rm);
      removed.push(images[k]!);
      images = images.filter((_, j) => j !== k);
    }
    drawImages();
  });

  app.querySelector<HTMLInputElement>('#files')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    uploading += files.length;
    drawImages();
    await Promise.all(
      files.map(async (f, k) => {
        try {
          const url = await uploadImage(`products/${pid}/${Date.now()}-${k}.jpg`, f);
          images.push(url);
        } catch (err) {
          console.error(err);
          toast(`Falha ao carregar ${f.name}.`, 'err');
        } finally {
          uploading--;
          drawImages();
        }
      }),
    );
  });

  const form = app.querySelector<HTMLFormElement>('#pform')!;
  app.querySelector('#reintUm')?.addEventListener('click', (e) => {
    e.preventDefault();
    const o = origemDe(p);
    const r = interpretar(o.titulo, o.pastas);
    form.querySelector<HTMLInputElement>('input[name="title"]')!.value = r.titulo;
    form.querySelector<HTMLInputElement>('input[name="categoryPath"]')!.value = caminhoTexto(r.categorias);
    toast('Título e categoria preenchidos — reveja e guarde.');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const checked = new Set(fd.getAll('sizes').map(String));
    const extraSizes = String(fd.get('extraSizes') ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const sizes = [...new Set([...SIZES_ADULT.filter((s) => checked.has(s)), ...SIZES_KIDS.filter((s) => checked.has(s)), ...extraSizes])];
    if (!sizes.length) return toast('Escolha pelo menos um tamanho.', 'err');
    if (!images.length) return toast('Adicione pelo menos uma imagem.', 'err');

    saveBtn.disabled = true;
    try {
      // miniatura: nova se a imagem principal mudou ou ainda não existia
      let thumb = existing?.thumb ?? '';
      if (images[0] && (!thumb || images[0] !== existing?.images[0])) {
        try {
          const nova = await criarMiniatura(images[0], pid);
          if (thumb) void deleteByUrl(thumb);
          thumb = nova;
        } catch (err) {
          console.error(err);
          thumb = '';
        }
      }
      await setDoc(
        doc(db, 'products', pid),
        {
          title: String(fd.get('title') ?? '').trim(),
          thumb,
          category: caminhoDe(String(fd.get('categoryPath') ?? ''))[0] ?? '',
          categoryPath: caminhoDe(String(fd.get('categoryPath') ?? '')),
          supplierRef: String(fd.get('supplierRef') ?? '').trim(),
          images,
          sizes,
          allowNameNumber: fd.has('allowNameNumber'),
          patchIds: fd.getAll('patchIds').map(String),
          active: fd.has('active'),
          updatedAt: serverTimestamp(),
          ...(isNew ? { createdAt: serverTimestamp() } : {}),
        },
        { merge: true },
      );
      removed.forEach((u) => void deleteByUrl(u));
      await loadProducts();
      toast('Artigo guardado.');
      location.hash = '#/artigos';
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar o artigo.', 'err');
      saveBtn.disabled = false;
    }
  });

  app.querySelector('#del')?.addEventListener('click', async () => {
    if (!confirm('Eliminar este artigo? As encomendas já feitas não são afetadas.')) return;
    try {
      await deleteDoc(doc(db, 'products', pid));
      [...images, ...removed, ...(existing?.thumb ? [existing.thumb] : [])].forEach((u) => void deleteByUrl(u));
      await loadProducts();
      toast('Artigo eliminado.');
      location.hash = '#/artigos';
    } catch (err) {
      console.error(err);
      toast('Não foi possível eliminar.', 'err');
    }
  });
}

/* ---------- patches ---------- */

function renderPatches(arg: string): void {
  const isNew = arg === 'novo';
  const editing: Patch | undefined = isNew
    ? toPatch(doc(collection(db, 'patches')).id, { order: (patches.at(-1)?.order ?? 0) + 1 })
    : arg
      ? patches.find((p) => p.id === arg)
      : undefined;

  app.innerHTML = `
    <section>
      <div class="toolbar">
        <h1>Patches</h1>
        <a class="btn primary" href="#/patches/novo">Novo patch</a>
      </div>
      <p class="muted">O nome do patch é o que aparece na mensagem ao fornecedor (linha <code>PATCH:</code>).</p>
      ${editing ? patchForm(editing, isNew) : ''}
      <div class="patch-list">${
        patches.length
          ? patches
              .map(
                (pt) => `
                <a class="card patch-row ${pt.active ? '' : 'inactive'} ${editing?.id === pt.id ? 'on' : ''}" href="#/patches/${encodeURIComponent(pt.id)}">
                  ${pt.imageUrl ? `<img src="${esc(pt.imageUrl)}" alt="">` : '<div class="ph"></div>'}
                  <b>${esc(pt.name)}</b>
                  <span class="muted small">${pt.active ? '' : 'Inativo'}</span>
                </a>`,
              )
              .join('')
          : '<p class="empty">Ainda não há patches.</p>'
      }</div>
    </section>`;

  if (!editing) return;
  let imageUrl = editing.imageUrl;
  let file: File | null = null;
  const preview = app.querySelector<HTMLElement>('#ptPreview')!;
  const drawPreview = (): void => {
    const src = file ? URL.createObjectURL(file) : imageUrl;
    preview.innerHTML = src
      ? `<img src="${esc(src)}" alt=""><button type="button" class="btn ghost small" id="ptRm">Remover imagem</button>`
      : '<span class="muted small">Sem imagem</span>';
    preview.querySelector('#ptRm')?.addEventListener('click', () => {
      file = null;
      imageUrl = '';
      drawPreview();
    });
  };
  drawPreview();

  app.querySelector<HTMLInputElement>('#ptFile')!.addEventListener('change', (e) => {
    file = (e.target as HTMLInputElement).files?.[0] ?? null;
    drawPreview();
  });

  const form = app.querySelector<HTMLFormElement>('#ptForm')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    try {
      let url = imageUrl;
      if (file) url = await uploadImage(`patches/${editing.id}/${Date.now()}.png`, file, 'image/png', 600);
      if (editing.imageUrl && editing.imageUrl !== url) void deleteByUrl(editing.imageUrl);
      await setDoc(doc(db, 'patches', editing.id), {
        name: String(fd.get('name') ?? '').trim(),
        order: Number(fd.get('order')) || 0,
        active: fd.has('active'),
        imageUrl: url,
      });
      await loadPatches();
      toast('Patch guardado.');
      location.hash = '#/patches';
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar o patch.', 'err');
      btn.disabled = false;
    }
  });

  app.querySelector('#ptDel')?.addEventListener('click', async () => {
    if (!confirm(`Eliminar o patch "${editing.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'patches', editing.id));
      if (editing.imageUrl) void deleteByUrl(editing.imageUrl);
      await loadPatches();
      toast('Patch eliminado.');
      location.hash = '#/patches';
    } catch (err) {
      console.error(err);
      toast('Não foi possível eliminar.', 'err');
    }
  });
}

function patchForm(pt: Patch, isNew: boolean): string {
  return `
    <form id="ptForm" class="card form patch-form">
      <h2>${isNew ? 'Novo patch' : 'Editar patch'}</h2>
      <div class="row">
        <label>Nome<input name="name" required value="${esc(pt.name)}" placeholder="Liga Portugal"></label>
        <label class="narrow">Ordem<input name="order" type="number" value="${pt.order}"></label>
      </div>
      <div class="row">
        <div id="ptPreview" class="pt-preview"></div>
        <label class="btn ghost file">Escolher imagem<input id="ptFile" type="file" accept="image/*" hidden></label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${pt.active ? 'checked' : ''}> Ativo</label>
      <div class="btns">
        <button class="btn primary" type="submit">Guardar</button>
        <a class="btn ghost" href="#/patches">Cancelar</a>
        ${isNew ? '' : '<button class="btn danger" type="button" id="ptDel">Eliminar</button>'}
      </div>
    </form>`;
}

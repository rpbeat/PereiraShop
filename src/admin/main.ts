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
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db, SHOP_NAME } from '../lib/firebase';
import { deleteByUrl, uploadImage } from '../lib/storage';
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
import { copyImage, copyImageAndText, copyText, itemMessage, orderSummary, waLink } from '../lib/whatsapp';

type OrderFilter = OrderStatus | 'ativas' | 'todas';

const app = document.getElementById('app') as HTMLElement;
const nav = document.getElementById('nav') as HTMLElement;
(document.getElementById('brand') as HTMLElement).textContent = `${SHOP_NAME} · Backoffice`;
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

const ACTIVE: OrderStatus[] = ['pendente', 'paga', 'encomendada', 'enviada'];

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
}

async function loadPatches(): Promise<void> {
  const snap = await getDocs(collection(db, 'patches'));
  patches = snap.docs
    .map((d) => toPatch(d.id, d.data()))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt'));
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
    <a href="#/patches">Patches</a>
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
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-copy],[data-summary],[data-sent],[data-copy-all]');
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
    case 'both':
      await safeCopy(() => copyImageAndText(item.imageUrl, itemMessage(item)), 'Imagem e texto copiados — cole no WhatsApp.');
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
        <button class="btn ghost small" data-summary="${o.id}">Copiar resumo da encomenda</button>
      </footer>
    </article>`;
}

function itemBlock(o: Order, i: OrderItem, idx: number, showOrder = false): string {
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
          <button class="btn primary small" data-copy="both" ${a}>Copiar imagem + texto</button>
          <button class="btn ghost small" data-copy="img" ${a}>Só imagem</button>
          <button class="btn ghost small" data-copy="txt" ${a}>Só texto</button>
          <button class="btn ghost small" data-sent="${o.id}" data-i="${idx}">${i.supplierSent ? 'Desmarcar' : 'Marcar como enviado'}</button>
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
        <a class="btn primary" href="#/artigos/novo">Novo artigo</a>
      </div>
      <div id="plist" class="grid"></div>
    </section>`;
  app.querySelector<HTMLInputElement>('#psearch')!.addEventListener('input', (e) => {
    productSearch = (e.target as HTMLInputElement).value;
    drawProducts();
  });
  drawProducts();
}

function drawProducts(): void {
  const list = app.querySelector('#plist');
  if (!list) return;
  const q = productSearch.trim().toLowerCase();
  const shown = products.filter((p) => !q || `${p.title} ${p.category} ${p.supplierRef}`.toLowerCase().includes(q));
  list.innerHTML = shown.length
    ? shown
        .map(
          (p) => `
          <a class="card product ${p.active ? '' : 'inactive'}" href="#/artigos/${encodeURIComponent(p.id)}">
            <div class="img">${p.images[0] ? `<img loading="lazy" src="${esc(p.images[0])}" alt="">` : ''}</div>
            <div class="title">${esc(p.title)}</div>
            <div class="muted small">${esc(p.category)}${p.category ? ' · ' : ''}${esc(p.sizes.join(' '))}</div>
            ${p.active ? '' : '<span class="tag">Oculto</span>'}
          </a>`,
        )
        .join('')
    : `<p class="empty">${products.length ? 'Nenhum artigo encontrado.' : 'Ainda não há artigos.'}</p>`;
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

  const cats = [...new Set(products.map((x) => x.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
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
          <label>Categoria<input name="category" list="cats" value="${esc(p.category)}" placeholder="Clubes Portugueses"></label>
          <label>Referência do fornecedor<input name="supplierRef" value="${esc(p.supplierRef)}" placeholder="Link do álbum ou código"></label>
        </div>
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
      await setDoc(
        doc(db, 'products', pid),
        {
          title: String(fd.get('title') ?? '').trim(),
          category: String(fd.get('category') ?? '').trim(),
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
      [...images, ...removed].forEach((u) => void deleteByUrl(u));
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

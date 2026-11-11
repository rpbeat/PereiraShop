import '../styles.css';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { auth, db, SHOP_NAME } from '../lib/firebase';
import {
  STATUS_LABELS,
  emptyCustomer,
  toCustomer,
  toOrder,
  toPatch,
  toProduct,
  type CartItem,
  type Customer,
  type OrderItem,
  type Patch,
  type Product,
} from '../lib/types';
import { authError, esc, fmtDate, itemDetails, orderCode, toast } from '../lib/ui';

type AuthMode = 'login' | 'register' | 'reset';

const app = document.getElementById('app') as HTMLElement;
const nav = document.getElementById('nav') as HTMLElement;
const modal = document.getElementById('modal') as HTMLElement;
(document.getElementById('brand') as HTMLElement).textContent = SHOP_NAME;
document.title = SHOP_NAME;

let user: User | null = null;
let profile: Customer = emptyCustomer();
let pendingProfile: Partial<Customer> | null = null;
let products: Product[] = [];
let patches = new Map<string, Patch>();
let cart: CartItem[] = [];
let filterCat = '';
let search = '';

/* ---------- carrinho (localStorage, por utilizador) ---------- */

const cartKey = (): string => `cart:${user?.uid ?? ''}`;

function loadCart(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(cartKey()) || '[]');
    cart = Array.isArray(raw) ? raw : [];
  } catch {
    cart = [];
  }
}

function saveCart(): void {
  try {
    localStorage.setItem(cartKey(), JSON.stringify(cart));
  } catch {
    /* armazenamento indisponível: carrinho fica só em memória */
  }
  renderNav();
}

/* ---------- arranque ---------- */

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) {
    nav.innerHTML = '';
    renderAuth('login');
    return;
  }
  app.innerHTML = '<p class="empty">A carregar…</p>';
  try {
    const [pSnap, ptSnap, profSnap] = await Promise.all([
      getDocs(query(collection(db, 'products'), where('active', '==', true))),
      getDocs(collection(db, 'patches')),
      getDoc(doc(db, 'users', u.uid)),
    ]);
    products = pSnap.docs
      .map((d) => toProduct(d.id, d.data()))
      .sort((a, b) => a.category.localeCompare(b.category, 'pt') || a.title.localeCompare(b.title, 'pt'));
    patches = new Map(ptSnap.docs.map((d) => [d.id, toPatch(d.id, d.data())]));
    profile = { ...toCustomer(profSnap.data()), ...(pendingProfile ?? {}) };
    if (!profile.name && u.displayName) profile.name = u.displayName;
  } catch (e) {
    console.error(e);
    app.innerHTML = '<p class="empty">Não foi possível carregar o catálogo. Tente recarregar a página.</p>';
    return;
  }
  loadCart();
  renderNav();
  route();
});

window.addEventListener('hashchange', () => {
  if (user) route();
});

modal.addEventListener('click', () => modal.classList.remove('open'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') modal.classList.remove('open');
});

function renderNav(): void {
  if (!user) {
    nav.innerHTML = '';
    return;
  }
  const n = cart.reduce((s, i) => s + i.qty, 0);
  nav.innerHTML = `
    <a href="#/">Catálogo</a>
    <a href="#/encomendas">Encomendas</a>
    <a href="#/conta">Conta</a>
    <a href="#/carrinho" class="cart-link">Carrinho${n ? ` <span class="badge">${n}</span>` : ''}</a>`;
}

function route(): void {
  const [page = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${page}`));
  switch (page) {
    case '':
      renderCatalog();
      break;
    case 'p':
      renderProduct(decodeURIComponent(arg));
      break;
    case 'carrinho':
      renderCart();
      break;
    case 'encomendas':
      void renderOrders();
      break;
    case 'conta':
      renderAccount();
      break;
    default:
      location.hash = '#/';
  }
}

/* ---------- autenticação ---------- */

function renderAuth(mode: AuthMode): void {
  const title = { login: 'Entrar', register: 'Criar conta', reset: 'Recuperar palavra-passe' }[mode];
  const submit = { login: 'Entrar', register: 'Criar conta', reset: 'Enviar link' }[mode];
  app.innerHTML = `
    <section class="card auth">
      <h1>${title}</h1>
      ${mode === 'login' ? '<p class="muted">Entre com a sua conta para ver o catálogo e fazer encomendas.</p>' : ''}
      ${mode === 'reset' ? '<p class="muted">Indique o email da conta. Vai receber um link para definir uma nova palavra-passe.</p>' : ''}
      <form id="authForm" class="form">
        ${
          mode === 'register'
            ? `<label>Nome<input name="name" required autocomplete="name"></label>
               <label>Telemóvel<input name="phone" type="tel" required autocomplete="tel"></label>`
            : ''
        }
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        ${
          mode !== 'reset'
            ? `<label>Palavra-passe<input name="password" type="password" required minlength="6"
                 autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>`
            : ''
        }
        <button class="btn primary big" type="submit">${submit}</button>
      </form>
      <p class="auth-links">
        ${mode === 'login' ? '<a href="#" data-mode="register">Criar conta</a>' : '<a href="#" data-mode="login">Já tenho conta</a>'}
        ${mode === 'login' ? '<a href="#" data-mode="reset">Esqueci-me da palavra-passe</a>' : ''}
      </p>
    </section>`;

  app.querySelectorAll<HTMLAnchorElement>('[data-mode]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      renderAuth(a.dataset.mode as AuthMode);
    }),
  );

  const form = app.querySelector<HTMLFormElement>('#authForm')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const btn = form.querySelector('button')!;
    btn.disabled = true;
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        toast('Se o email estiver registado, vai receber um link em breve.');
        renderAuth('login');
      } else {
        const name = String(fd.get('name') ?? '').trim();
        const phone = String(fd.get('phone') ?? '').trim();
        pendingProfile = { name, phone };
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, 'users', cred.user.uid), {
          ...emptyCustomer(),
          name,
          phone,
          email,
          createdAt: serverTimestamp(),
        });
        sendEmailVerification(cred.user).catch(() => undefined);
      }
    } catch (err) {
      toast(authError(err), 'err');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- catálogo ---------- */

function renderCatalog(): void {
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  app.innerHTML = `
    <section>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Procurar artigo…" value="${esc(search)}">
      </div>
      ${
        cats.length > 1
          ? `<div class="chips">${['', ...cats]
              .map((c) => `<button class="chip ${c === filterCat ? 'on' : ''}" data-cat="${esc(c)}">${c ? esc(c) : 'Todos'}</button>`)
              .join('')}</div>`
          : ''
      }
      <div class="grid" id="grid"></div>
    </section>`;

  app.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) =>
    b.addEventListener('click', () => {
      filterCat = b.dataset.cat ?? '';
      renderCatalog();
    }),
  );
  app.querySelector<HTMLInputElement>('#search')!.addEventListener('input', (e) => {
    search = (e.target as HTMLInputElement).value;
    drawGrid();
  });
  drawGrid();
}

function drawGrid(): void {
  const grid = app.querySelector('#grid');
  if (!grid) return;
  const q = search.trim().toLowerCase();
  const shown = products.filter(
    (p) => (!filterCat || p.category === filterCat) && (!q || `${p.title} ${p.category}`.toLowerCase().includes(q)),
  );
  grid.innerHTML = shown.length
    ? shown
        .map(
          (p) => `
          <a class="card product" href="#/p/${encodeURIComponent(p.id)}">
            <div class="img">${p.images[0] ? `<img loading="lazy" src="${esc(p.images[0])}" alt="${esc(p.title)}">` : ''}</div>
            <div class="title">${esc(p.title)}</div>
            ${p.category ? `<div class="muted small">${esc(p.category)}</div>` : ''}
          </a>`,
        )
        .join('')
    : `<p class="empty">${products.length ? 'Nenhum artigo encontrado.' : 'Ainda não há artigos no catálogo.'}</p>`;
}

/* ---------- artigo ---------- */

function renderProduct(id: string): void {
  const p = products.find((x) => x.id === id);
  if (!p) {
    app.innerHTML = '<p class="empty">Artigo não encontrado. <a href="#/">Voltar ao catálogo</a></p>';
    return;
  }
  const allowed = p.patchIds
    .map((pid) => patches.get(pid))
    .filter((x): x is Patch => !!x && x.active)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt'));

  app.innerHTML = `
    <a href="#/" class="back">← Catálogo</a>
    <section class="product-page">
      <div class="gallery">
        <button class="main-img" id="mainBtn" type="button" aria-label="Ampliar imagem">
          ${p.images[0] ? `<img id="mainImg" src="${esc(p.images[0])}" alt="${esc(p.title)}">` : ''}
        </button>
        ${
          p.images.length > 1
            ? `<div class="thumbs">${p.images
                .map((u, i) => `<button type="button" class="thumb ${i === 0 ? 'on' : ''}" data-img="${esc(u)}"><img src="${esc(u)}" alt=""></button>`)
                .join('')}</div>`
            : ''
        }
      </div>
      <form id="addForm" class="form details">
        ${p.category ? `<p class="muted small">${esc(p.category)}</p>` : ''}
        <h1>${esc(p.title)}</h1>
        <fieldset>
          <legend>Tamanho</legend>
          <div class="sizes">${p.sizes
            .map((s) => `<label class="size"><input type="radio" name="size" value="${esc(s)}" required><span>${esc(s)}</span></label>`)
            .join('')}</div>
        </fieldset>
        ${
          p.allowNameNumber
            ? `<fieldset>
                <legend>Personalização <span class="muted">(opcional)</span></legend>
                <div class="row">
                  <label>Nome<input name="pname" maxlength="15" placeholder="QUARESMA" class="upper" autocomplete="off"></label>
                  <label class="narrow">Número<input name="pnumber" inputmode="numeric" pattern="[0-9]{1,2}" maxlength="2" placeholder="23" autocomplete="off"></label>
                </div>
              </fieldset>`
            : ''
        }
        ${
          allowed.length
            ? `<fieldset>
                <legend>Patches <span class="muted">(opcional)</span></legend>
                <div class="patches">${allowed
                  .map(
                    (pt) => `<label class="patch"><input type="checkbox" name="patch" value="${esc(pt.id)}">
                      ${pt.imageUrl ? `<img src="${esc(pt.imageUrl)}" alt="">` : ''}<span>${esc(pt.name)}</span></label>`,
                  )
                  .join('')}</div>
              </fieldset>`
            : ''
        }
        <div class="row">
          <label class="narrow">Quantidade<input name="qty" type="number" min="1" max="20" value="1" required></label>
        </div>
        <label>Observações <span class="muted">(opcional)</span><textarea name="notes" rows="2" maxlength="300"></textarea></label>
        <button class="btn primary big" type="submit">Adicionar ao carrinho</button>
      </form>
    </section>`;

  const mainImg = app.querySelector<HTMLImageElement>('#mainImg');
  app.querySelectorAll<HTMLButtonElement>('[data-img]').forEach((b) =>
    b.addEventListener('click', () => {
      if (mainImg) mainImg.src = b.dataset.img ?? '';
      app.querySelectorAll('.thumb').forEach((t) => t.classList.toggle('on', t === b));
    }),
  );
  app.querySelector('#mainBtn')!.addEventListener('click', () => {
    if (!mainImg) return;
    modal.innerHTML = `<img src="${esc(mainImg.src)}" alt="">`;
    modal.classList.add('open');
  });

  const nameInput = app.querySelector<HTMLInputElement>('input[name="pname"]');
  nameInput?.addEventListener('input', () => {
    const pos = nameInput.selectionStart;
    nameInput.value = nameInput.value.toUpperCase();
    nameInput.setSelectionRange(pos, pos);
  });

  const form = app.querySelector<HTMLFormElement>('#addForm')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patchNames = fd
      .getAll('patch')
      .map((v) => patches.get(String(v))?.name)
      .filter((n): n is string => !!n);
    const item: CartItem = {
      key: crypto.randomUUID(),
      productId: p.id,
      title: p.title,
      imageUrl: p.images[0] ?? '',
      size: String(fd.get('size') ?? ''),
      name: String(fd.get('pname') ?? '').trim().toUpperCase(),
      number: String(fd.get('pnumber') ?? '').trim(),
      patches: patchNames,
      qty: Math.min(20, Math.max(1, Number(fd.get('qty')) || 1)),
      notes: String(fd.get('notes') ?? '').trim(),
      supplierSent: false,
    };
    cart.push(item);
    saveCart();
    form.reset();
    toast('Adicionado ao carrinho.');
  });
}

/* ---------- carrinho / checkout ---------- */

function renderCart(): void {
  if (!cart.length) {
    app.innerHTML = `
      <section class="narrow-page">
        <h1>Carrinho</h1>
        <p class="empty">O carrinho está vazio. <a href="#/">Ver catálogo</a></p>
      </section>`;
    return;
  }
  app.innerHTML = `
    <section class="cart-page">
      <div>
        <h1>Carrinho</h1>
        <div class="items">${cart
          .map(
            (i) => `
            <article class="card line">
              ${i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="">` : '<div class="ph"></div>'}
              <div class="grow">
                <a href="#/p/${encodeURIComponent(i.productId)}"><b>${esc(i.title)}</b></a>
                ${itemDetails(i)}
              </div>
              <button class="btn ghost small" type="button" data-remove="${esc(i.key)}">Remover</button>
            </article>`,
          )
          .join('')}</div>
      </div>
      <form id="checkout" class="card form checkout">
        <h2>Dados de entrega</h2>
        <label>Nome<input name="name" required autocomplete="name" value="${esc(profile.name)}"></label>
        <label>Telemóvel<input name="phone" type="tel" required autocomplete="tel" value="${esc(profile.phone)}"></label>
        <label>Morada<input name="address" required autocomplete="street-address" value="${esc(profile.address)}"></label>
        <div class="row">
          <label class="narrow">Código postal<input name="postalCode" required autocomplete="postal-code" placeholder="0000-000" value="${esc(profile.postalCode)}"></label>
          <label>Localidade<input name="city" required autocomplete="address-level2" value="${esc(profile.city)}"></label>
        </div>
        <label>Observações <span class="muted">(opcional)</span><textarea name="notes" rows="3" maxlength="500"></textarea></label>
        <p class="muted small">Não há pagamento online. Depois de registar a encomenda, entramos em contacto com os dados de pagamento.</p>
        <button class="btn primary big" type="submit">Registar encomenda</button>
      </form>
    </section>`;

  app.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      cart = cart.filter((i) => i.key !== b.dataset.remove);
      saveCart();
      renderCart();
    }),
  );

  const form = app.querySelector<HTMLFormElement>('#checkout')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData(form);
    const val = (k: string): string => String(fd.get(k) ?? '').trim();
    const customer: Customer = {
      name: val('name'),
      phone: val('phone'),
      address: val('address'),
      postalCode: val('postalCode'),
      city: val('city'),
    };
    const items: OrderItem[] = cart.map((i) => ({
      productId: i.productId,
      title: i.title,
      imageUrl: i.imageUrl,
      size: i.size,
      name: i.name,
      number: i.number,
      patches: i.patches,
      qty: i.qty,
      notes: i.notes,
      supplierSent: false,
    }));
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    btn.disabled = true;
    try {
      const ref = await addDoc(collection(db, 'orders'), {
        uid: user.uid,
        email: user.email ?? '',
        customer,
        items,
        notes: val('notes'),
        status: 'pendente',
        createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'users', user.uid), customer, { merge: true }).catch(() => undefined);
      profile = customer;
      cart = [];
      saveCart();
      toast(`Encomenda #${orderCode(ref.id)} registada. Obrigado!`);
      location.hash = '#/encomendas';
    } catch (err) {
      console.error(err);
      toast('Não foi possível registar a encomenda. Tente novamente.', 'err');
      btn.disabled = false;
    }
  });
}

/* ---------- encomendas do cliente ---------- */

async function renderOrders(): Promise<void> {
  app.innerHTML = `
    <section class="narrow-page">
      <h1>As minhas encomendas</h1>
      <div id="list"><p class="empty">A carregar…</p></div>
    </section>`;
  const list = app.querySelector('#list')!;
  if (!user) return;
  try {
    const snap = await getDocs(query(collection(db, 'orders'), where('uid', '==', user.uid)));
    const orders = snap.docs
      .map((d) => toOrder(d.id, d.data()))
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
    list.innerHTML = orders.length
      ? orders
          .map(
            (o) => `
            <article class="card order">
              <header class="order-head">
                <b>#${orderCode(o.id)}</b>
                <span class="muted">${fmtDate(o.createdAt)}</span>
                <span class="status s-${o.status}">${STATUS_LABELS[o.status]}</span>
              </header>
              ${o.items
                .map(
                  (i) => `
                  <div class="line">
                    ${i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="">` : '<div class="ph"></div>'}
                    <div class="grow"><b>${esc(i.title)}</b>${itemDetails(i)}</div>
                  </div>`,
                )
                .join('')}
            </article>`,
          )
          .join('')
      : '<p class="empty">Ainda não fez nenhuma encomenda. <a href="#/">Ver catálogo</a></p>';
  } catch (err) {
    console.error(err);
    list.innerHTML = '<p class="empty">Não foi possível carregar as encomendas.</p>';
  }
}

/* ---------- conta ---------- */

function renderAccount(): void {
  if (!user) return;
  app.innerHTML = `
    <section class="narrow-page">
      <h1>Conta</h1>
      <form id="profile" class="card form">
        <p class="muted">${esc(user.email)}${user.emailVerified ? '' : ' · email por confirmar'}</p>
        <label>Nome<input name="name" required value="${esc(profile.name)}"></label>
        <label>Telemóvel<input name="phone" type="tel" required value="${esc(profile.phone)}"></label>
        <label>Morada<input name="address" value="${esc(profile.address)}"></label>
        <div class="row">
          <label class="narrow">Código postal<input name="postalCode" value="${esc(profile.postalCode)}"></label>
          <label>Localidade<input name="city" value="${esc(profile.city)}"></label>
        </div>
        <div class="btns">
          <button class="btn primary" type="submit">Guardar</button>
          <button class="btn ghost" type="button" id="pw">Alterar palavra-passe</button>
          <button class="btn ghost" type="button" id="logout">Sair</button>
        </div>
      </form>
    </section>`;

  const form = app.querySelector<HTMLFormElement>('#profile')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData(form);
    const next = toCustomer(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()])));
    try {
      await setDoc(doc(db, 'users', user.uid), next, { merge: true });
      profile = next;
      toast('Dados guardados.');
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar.', 'err');
    }
  });
  app.querySelector('#pw')!.addEventListener('click', async () => {
    if (!user?.email) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      toast('Enviámos um link para o seu email.');
    } catch (err) {
      toast(authError(err), 'err');
    }
  });
  app.querySelector('#logout')!.addEventListener('click', () => {
    location.hash = '#/';
    void signOut(auth);
  });
}

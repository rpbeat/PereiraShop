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
import { carregarCatalogo, type ItemIndice } from '../lib/catalogo';
import { epocaDe, ordemEpocas } from '../lib/nomes';
import { fmtEur } from '../lib/precos';
import { logoHtml } from '../lib/logo';
import { auth, db, SHOP_NAME } from '../lib/firebase';
import {
  STATUS_LABELS_CLIENTE,
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
import { aCarregar, authError, carregamento, esc, fmtDate, instalarLoaders, itemDetails, loaderHtml, ocupado, orderCode, toast } from '../lib/ui';

type AuthMode = 'login' | 'register' | 'reset';

const app = document.getElementById('app') as HTMLElement;
const nav = document.getElementById('nav') as HTMLElement;
instalarLoaders();
const modal = document.getElementById('modal') as HTMLElement;
(document.getElementById('brand') as HTMLElement).innerHTML = logoHtml(SHOP_NAME);
document.title = SHOP_NAME;

let user: User | null = null;
let profile: Customer = emptyCustomer();
let pendingProfile: Partial<Customer> | null = null;
/** Durante o registo: o arranque espera que o perfil fique gravado. */
let aRegistar = false;
/** Conta acabada de criar (fica por aprovar): o arranque ignora-a. */
let uidRegistado = '';
/** Mensagem a mostrar no ecrã de entrada (ex.: conta à espera de aprovação). */
let avisoEntrada: { titulo: string; texto: string } | null = null;

const AVISO_PENDENTE = {
  titulo: 'Conta à espera de aprovação',
  texto: 'A tua conta ainda não foi aprovada. Assim que estiver, recebes um email e já podes entrar. Não demora: o mister está só a rever a convocatória.',
};

/** A conta pode entrar? (aprovada, ou administrador) e não bloqueada. */
async function estadoConta(uid: string): Promise<'ok' | 'pendente' | 'bloqueada'> {
  const existe = (col: string): Promise<boolean> =>
    getDoc(doc(db, col, uid))
      .then((s) => s.exists())
      .catch(() => false);
  const [aprovada, admin, bloqueada] = await Promise.all([existe('aprovados'), existe('admins'), existe('bloqueados')]);
  if (bloqueada) return 'bloqueada';
  return aprovada || admin ? 'ok' : 'pendente';
}
/** Lista leve do catálogo (vem do índice): só o necessário para a grelha e a navegação. */
interface ItemCat { id: string; title: string; categoryPath: string[]; thumb: string; epoca: string }
let products: ItemCat[] = [];
/** Artigos completos já lidos (fotos, tamanhos, patches) — cada artigo só é lido uma vez por visita. */
const detalhes = new Map<string, Product | null>();
let patches = new Map<string, Patch>();
let cart: CartItem[] = [];
let filterPath: string[] = [];
/** Filtro de época dentro da categoria ("2026/27", "1990/93"… ou "outras" para artigos sem época). */
let filtroEpoca = '';
let search = '';

/* ---------- costas da camisola (pré-visualização) ---------- */

const KIT_PATH = 'M66 14 Q100 30 134 14 L184 38 L198 92 L160 104 L156 92 L156 226 L44 226 L44 92 L40 104 L2 92 L16 38 Z';

function kitSvg(nome: string, num: string, fill = '#1e6b4c', ink = '#ffffff', extra = ''): string {
  const n = nome.trim().toUpperCase();
  const vazioN = !n;
  const vazioNum = !num.trim();
  const tl = n.length > 9 ? ` textLength="${Math.min(104, n.length * 11)}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg class="kit ${extra}" viewBox="0 0 200 232" role="img" aria-label="Costas da camisola">
    <path class="body" d="${KIT_PATH}" fill="${esc(fill)}" stroke="rgb(0 0 0 / .12)" stroke-width="1.5"/>
    <path d="M66 14 Q100 30 134 14" fill="none" stroke="rgb(0 0 0 / .18)" stroke-width="3"/>
    <text class="nome ${vazioN ? 'vazio' : ''}" x="100" y="72" fill="${esc(ink)}"${tl}>${esc(n || 'NOME')}</text>
    <text class="num ${vazioNum ? 'vazio' : ''}" x="100" y="170" fill="${esc(ink)}">${esc(num.trim() || '10')}</text>
  </svg>`;
}

/** Cor dominante do centro da imagem principal (para pintar a pré-visualização). */
function corDaCamisola(url: string): Promise<{ fill: string; ink: string } | null> {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        // zona central (o peito da camisola), longe do fundo da fotografia
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        ctx.drawImage(img, w * 0.38, h * 0.42, w * 0.24, h * 0.22, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        // cor dominante: agrupa tons parecidos e escolhe o grupo maior (dá prioridade a cores vivas,
        // para que numa camisola às riscas azul e branca saia azul e não uma mistura)
        const grupos = new Map<number, { n: number; r: number; g: number; b: number; peso: number }>();
        for (let i = 0; i < d.length; i += 4) {
          const pr = d[i]!, pg = d[i + 1]!, pb = d[i + 2]!;
          const k = ((pr >> 5) << 6) | ((pg >> 5) << 3) | (pb >> 5);
          const sat = (Math.max(pr, pg, pb) - Math.min(pr, pg, pb)) / 255;
          const gr = grupos.get(k) ?? { n: 0, r: 0, g: 0, b: 0, peso: 0 };
          gr.n++; gr.r += pr; gr.g += pg; gr.b += pb; gr.peso += 1 + sat * 1.5;
          grupos.set(k, gr);
        }
        const top = [...grupos.values()].sort((x, y) => y.peso - x.peso)[0]!;
        const r = Math.round(top.r / top.n), g = Math.round(top.g / top.n), b = Math.round(top.b / top.n);
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        resolve({ fill: `rgb(${r} ${g} ${b})`, ink: lum > 0.6 ? '#13231c' : '#ffffff' });
      } catch {
        resolve(null); // imagem sem CORS: fica a cor por omissão
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

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
  if (aRegistar || u.uid === uidRegistado) return; // o registo trata do resto
  app.innerHTML = loaderHtml('A preparar o balneário…');
  carregamento(true);
  try {
    await arrancar(u);
  } finally {
    carregamento(false);
  }
});

async function arrancar(u: User): Promise<void> {
  // só contas aprovadas no backoffice entram (as regras do Firestore também o garantem)
  const estado = await estadoConta(u.uid);
  if (user !== u) return;
  if (estado === 'bloqueada') return renderBloqueada();
  if (estado === 'pendente') {
    avisoEntrada ??= AVISO_PENDENTE;
    await signOut(auth);
    return;
  }
  try {
    const paraItem = (i: ItemIndice): ItemCat => ({ id: i.id, title: i.t, categoryPath: i.p ?? [], thumb: i.i ?? '', epoca: epocaDe(i.t) });
    const [cat, profSnap] = await Promise.all([
      carregarCatalogo(db, async () => {
        // ainda sem índice publicado: lê os artigos diretamente (mais leituras)
        const [pSnap, ptSnap] = await Promise.all([
          getDocs(query(collection(db, 'products'), where('active', '==', true))),
          getDocs(collection(db, 'patches')),
        ]);
        const lista = pSnap.docs.map((d) => toProduct(d.id, d.data()));
        lista.forEach((p) => detalhes.set(p.id, p));
        return {
          itens: lista.map((p) => ({ id: p.id, t: p.title, p: p.categoryPath, i: p.thumb || p.images[0] || '' })),
          patches: ptSnap.docs.map((d) => toPatch(d.id, d.data())).filter((x) => x.active),
        };
      }),
      getDoc(doc(db, 'users', u.uid)),
    ]);
    products = cat.itens
      .map(paraItem)
      .sort((a, b) => a.categoryPath.join('\u0000').localeCompare(b.categoryPath.join('\u0000'), 'pt') || a.title.localeCompare(b.title, 'pt'));
    patches = new Map(cat.patches.map((x) => [x.id, toPatch(x.id, { ...x, active: true })]));
    profile = { ...toCustomer(profSnap.data()), ...(pendingProfile ?? {}) };
    if (!profile.name && u.displayName) profile.name = u.displayName;
  } catch (e) {
    console.error(e);
    app.innerHTML = '<p class="empty">Não foi possível carregar o catálogo. Recarrega a página.</p>';
    return;
  }
  loadCart();
  renderNav();
  route();
}

function renderBloqueada(): void {
  user = null; // não deixa a navegação abrir outras páginas
  nav.innerHTML = '';
  app.innerHTML = `
    <section class="card bloqueada-aviso">
      <h1>Conta bloqueada</h1>
      <p>Esta conta não pode fazer encomendas de momento. Se achas que é engano, fala connosco.</p>
      <button class="btn" id="sairBloq">Sair</button>
    </section>`;
  app.querySelector('#sairBloq')!.addEventListener('click', () => void signOut(auth));
}

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

/** Endereço de uma categoria: #/c/Liga Portugal/Benfica/Crianças (e, opcionalmente, ?epoca=2026/27) */
const catHref = (path: string[], epoca = ''): string =>
  (path.length ? `#/c/${path.map(encodeURIComponent).join('/')}` : '#/') + (epoca ? `?epoca=${encodeURIComponent(epoca)}` : '');

function route(): void {
  const [caminho = '', qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = caminho.split('/');
  const [page = '', arg = ''] = parts;
  filtroEpoca = new URLSearchParams(qs).get('epoca') ?? '';
  window.scrollTo(0, 0);
  const sec = page === 'c' || page === 'p' ? '' : page;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${sec}`));
  switch (page) {
    case '':
      filterPath = [];
      renderCatalog();
      break;
    case 'c':
      filterPath = parts.slice(1).filter(Boolean).map((x) => {
        try { return decodeURIComponent(x); } catch { return x; }
      }).slice(0, 4);
      renderCatalog();
      break;
    case 'p':
      void renderProduct(decodeURIComponent(arg));
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
    <div class="auth-wrap">
    <section class="pitch" aria-hidden="${mode === 'login' ? 'false' : 'true'}">
      ${kitSvg('Chumbo', '00', '#ffffff', '#0f3d2e', 'kit-mini')}
      <h1><span>Pé de chumbo,</span> <span>camisola de craque.</span></h1>
      <p>Escolhe o clube, o tamanho, o nome e o número. Em campo podes ser um desastre, mas pelo menos vais bem vestido.</p>
    </section>
    <div class="auth-side">
    <section class="auth">
      ${avisoEntrada ? `<div class="aviso-conta" role="status"><b>${esc(avisoEntrada.titulo)}</b><p>${esc(avisoEntrada.texto)}</p></div>` : ''}
      <h2>${title}</h2>
      ${mode === 'login' ? '<p class="muted">Entra com a tua conta para ver o catálogo e fazer encomendas.</p>' : ''}
      ${mode === 'reset' ? '<p class="muted">Indica o email da conta. Vais receber um link para escolher uma nova palavra-passe.</p>' : ''}
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
    </section>
    </div>
    </div>`;

  app.querySelectorAll<HTMLAnchorElement>('[data-mode]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      avisoEntrada = null;
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
    avisoEntrada = null;
    uidRegistado = '';
    app.querySelector('.aviso-conta')?.remove();
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        toast('Se o email estiver registado, vais receber um link em breve.');
        renderAuth('login');
      } else {
        const name = String(fd.get('name') ?? '').trim();
        const phone = String(fd.get('phone') ?? '').trim();
        pendingProfile = { name, phone };
        aRegistar = true;
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          uidRegistado = cred.user.uid;
          await updateProfile(cred.user, { displayName: name });
          await setDoc(doc(db, 'users', cred.user.uid), {
            ...emptyCustomer(),
            name,
            phone,
            email,
            createdAt: serverTimestamp(),
          });
          await sendEmailVerification(cred.user).catch(() => undefined);
          // a conta nova fica à espera de aprovação no backoffice
          avisoEntrada = {
            titulo: 'Conta criada!',
            texto: 'Agora só falta seres aprovado. Quando a conta estiver aprovada recebes um email e já podes entrar. Entretanto, confirma o teu email pelo link que te enviámos.',
          };
          aRegistar = false;
          await signOut(auth);
        } catch (err) {
          aRegistar = false;
          if (auth.currentUser) await signOut(auth).catch(() => undefined);
          throw err;
        }
      }
    } catch (err) {
      toast(authError(err), 'err');
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- catálogo ---------- */

const startsWith = (path: string[], prefix: string[]): boolean => prefix.every((c, i) => path[i] === c);

const conta = (prefix: string[]): number => products.filter((p) => startsWith(p.categoryPath, prefix)).length;
const opcoes = (prefix: string[]): string[] =>
  [...new Set(products.filter((p) => startsWith(p.categoryPath, prefix)).map((p) => p.categoryPath[prefix.length]).filter((c): c is string => !!c))]
    .sort((a, b) => a.localeCompare(b, 'pt'));

/**
 * Até escolher um clube, o catálogo mostra cartões de categorias (1 imagem por categoria)
 * em vez das camisolas: as fotos dos artigos só são pedidas quando o cliente escolhe o que quer ver.
 */
const mostraCategorias = (): boolean => !search.trim() && filterPath.length < 2 && opcoes(filterPath).length > 0;

function renderCatalog(): void {
  // se a categoria do endereço já não existe, sobe um nível
  while (filterPath.length && !products.some((p) => startsWith(p.categoryPath, filterPath))) filterPath = filterPath.slice(0, -1);

  // barra lateral (computador): ligas e, na liga escolhida, os clubes
  const ligas = opcoes([]);
  const side = `
    <nav class="cat-side" aria-label="Categorias">
      <a class="side-all ${filterPath.length ? '' : 'on'}" href="#/">Todas as categorias <span>${products.length}</span></a>
      ${ligas
        .map((l) => {
          const aberta = filterPath[0] === l;
          const clubes = aberta ? opcoes([l]) : [];
          return `<div class="side-liga ${aberta ? 'open' : ''}">
            <a class="${aberta && filterPath.length === 1 ? 'on' : ''}" href="${catHref([l])}">${esc(l)} <span>${conta([l])}</span></a>
            ${clubes.length ? `<div class="side-clubes">${clubes
              .map((c) => `<a class="${filterPath[1] === c ? 'on' : ''}" href="${catHref([l, c])}">${esc(c)} <span>${conta([l, c])}</span></a>`)
              .join('')}</div>` : ''}
          </div>`;
        })
        .join('')}
    </nav>`;

  // botões por nível: no telemóvel mostram todos os níveis; no computador só a partir do tipo
  const rows: string[] = [];
  for (let level = 0; level <= filterPath.length && level < 4; level++) {
    const prefix = filterPath.slice(0, level);
    const opts = opcoes(prefix);
    if (!opts.length || (level === 0 && opts.length < 2 && !filterPath.length)) continue;
    const sel = filterPath[level] ?? '';
    rows.push(`<div class="chips level-${level}" ${level === filterPath.length ? 'data-next' : ''}>${['', ...opts]
      .map((c) => `<a class="chip ${c === sel ? 'on' : ''}" href="${catHref(c ? [...prefix, c] : prefix, level >= 2 ? filtroEpoca : '')}">${c ? esc(c) : level ? 'Todos' : 'Tudo'}</a>`)
      .join('')}</div>`);
  }

  app.innerHTML = `
    <section class="catalogo">
      ${side}
      <div class="cat-main">
        <div class="cat-head">
          <h1>${esc(filterPath[filterPath.length - 1] ?? 'Catálogo')}</h1>
          <input id="search" type="search" placeholder="${filterPath.length ? `Procurar em ${esc(filterPath[filterPath.length - 1]!)}…` : 'Procurar clube, época, tipo…'}" aria-label="Procurar" value="${esc(search)}">
        </div>
        ${filterPath.length ? `<p class="crumbs">${['Catálogo', ...filterPath].map((c, i) => `<a href="${catHref(filterPath.slice(0, i))}">${esc(c)}</a>`).join(' › ')}</p>` : ''}
        ${rows.join('')}
        <div class="chips epocas" id="epocas" hidden></div>
        <p class="muted small" id="resultado"></p>
        <div class="grid" id="grid"></div>
        <div id="mais"></div>
      </div>
    </section>`;

  app.querySelector<HTMLInputElement>('#search')!.addEventListener('input', (e) => {
    search = (e.target as HTMLInputElement).value;
    drawGrid();
  });
  drawGrid();
}

const POR_PAGINA = 48;
let mostrar = POR_PAGINA;
let observador: IntersectionObserver | null = null;

function drawTiles(grid: Element): void {
  const cats = opcoes(filterPath);
  grid.classList.add('tiles');
  grid.innerHTML = cats
    .map((c) => {
      const path = [...filterPath, c];
      const capa = products.find((p) => startsWith(p.categoryPath, path) && p.thumb)?.thumb ?? '';
      const n = conta(path);
      return `<a class="tile" href="${catHref(path)}">
        <div class="img">${capa ? `<img loading="lazy" decoding="async" src="${esc(capa)}" alt="">` : ''}</div>
        <div class="tile-txt"><b>${esc(c)}</b><span>${n} ${n === 1 ? 'artigo' : 'artigos'}</span></div>
      </a>`;
    })
    .join('');
}

function drawGrid(): void {
  const grid = app.querySelector('#grid');
  const info = app.querySelector('#resultado');
  if (!grid || !info) return;
  observador?.disconnect();
  // a fila de botões do nível seguinte repete os cartões: esconde-a enquanto há cartões
  const tiles = mostraCategorias();
  app.querySelector<HTMLElement>('[data-next]')?.toggleAttribute('hidden', tiles);
  const epocasEl = app.querySelector<HTMLElement>('#epocas');
  epocasEl?.toggleAttribute('hidden', true);
  if (tiles) {
    info.innerHTML = '';
    drawTiles(grid);
    return;
  }
  grid.classList.remove('tiles');
  const q = search.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const terms = q.split(/\s+/).filter(Boolean);
  const base = products.filter((p) => {
    if (!startsWith(p.categoryPath, filterPath)) return false;
    if (!terms.length) return true;
    const hay = `${p.title} ${p.categoryPath.join(' ')}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return terms.every((t) => hay.includes(t));
  });

  // épocas presentes nesta categoria: só aparece a fila se houver mais do que uma
  const epocas = [...new Set(base.map((p) => p.epoca).filter(Boolean))].sort(ordemEpocas);
  const semEpoca = base.some((p) => !p.epoca);
  const opcoesEpoca = [...epocas, ...(semEpoca ? ['outras'] : [])];
  if (filtroEpoca && !opcoesEpoca.includes(filtroEpoca)) filtroEpoca = '';
  if (epocasEl && opcoesEpoca.length > 1) {
    epocasEl.innerHTML =
      `<span class="chips-label">Época</span>` +
      ['', ...opcoesEpoca]
        .map((e) => `<a class="chip ${e === filtroEpoca ? 'on' : ''}" href="${catHref(filterPath, e)}">${e ? (e === 'outras' ? 'Outras' : esc(e)) : 'Todas'}</a>`)
        .join('');
    epocasEl.removeAttribute('hidden');
  }
  const shown = filtroEpoca ? base.filter((p) => (filtroEpoca === 'outras' ? !p.epoca : p.epoca === filtroEpoca)) : base;
  const card = (p: ItemCat): string => `
    <a class="card product" href="#/p/${encodeURIComponent(p.id)}">
      <div class="img">${p.thumb ? `<img loading="lazy" decoding="async" src="${esc(p.thumb)}" alt="${esc(p.title)}">` : ''}</div>
      <div class="title">${esc(p.title)}</div>
      ${p.categoryPath.length ? `<div class="muted small">${esc(p.categoryPath.slice(1).join(' › ') || p.categoryPath[0])}</div>` : ''}
    </a>`;

  // mostra 48 de cada vez: as imagens seguintes só são pedidas ao chegar ao fim da página
  mostrar = POR_PAGINA;
  observador?.disconnect();
  grid.innerHTML = shown.length
    ? shown.slice(0, mostrar).map(card).join('')
    : `<p class="empty">${products.length ? 'Nada por aqui. Experimenta outro clube ou outra época.' : 'O catálogo ainda está no balneário. Volta daqui a pouco.'}</p>`;
  info.innerHTML = terms.length
    ? `${shown.length} ${shown.length === 1 ? 'resultado' : 'resultados'}${filterPath.length ? ` em ${esc(filterPath.join(' › '))}. <a href="#/" id="todoCat">Procurar em todo o catálogo</a>` : ''}`
    : '';
  info.querySelector('#todoCat')?.addEventListener('click', () => { filterPath = []; });

  const mais = app.querySelector('#mais');
  if (mais && shown.length > mostrar) {
    observador = new IntersectionObserver((ent) => {
      if (!ent[0]?.isIntersecting) return;
      grid.insertAdjacentHTML('beforeend', shown.slice(mostrar, mostrar + POR_PAGINA).map(card).join(''));
      mostrar += POR_PAGINA;
      if (mostrar >= shown.length) observador?.disconnect();
    }, { rootMargin: '800px' });
    observador.observe(mais);
  }
}

/* ---------- artigo ---------- */

/** Lê um artigo completo (1 leitura na primeira vez; depois vem da memória). */
async function lerArtigo(id: string): Promise<Product | null> {
  if (detalhes.has(id)) return detalhes.get(id) ?? null;
  const snap = await getDoc(doc(db, 'products', id));
  const p = snap.exists() ? toProduct(snap.id, snap.data()) : null;
  detalhes.set(id, p && p.active ? p : null);
  return detalhes.get(id) ?? null;
}

async function renderProduct(id: string): Promise<void> {
  if (!detalhes.has(id)) app.innerHTML = loaderHtml('A ir buscar a camisola…');
  let p: Product | null = null;
  try {
    p = await aCarregar(() => lerArtigo(id));
  } catch (err) {
    console.error(err);
  }
  if (location.hash !== `#/p/${encodeURIComponent(id)}` && location.hash !== `#/p/${id}`) return; // o cliente já mudou de página
  if (!p) {
    app.innerHTML = '<p class="empty">Artigo não encontrado. <a href="#/">Voltar ao catálogo</a></p>';
    return;
  }
  const allowed = p.patchIds
    .map((pid) => patches.get(pid))
    .filter((x): x is Patch => !!x && x.active)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt'));

  app.innerHTML = `
    <a href="${catHref(p.categoryPath)}" class="back">← ${esc(p.categoryPath[p.categoryPath.length - 1] ?? 'Catálogo')}</a>
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
        ${p.categoryPath.length ? `<p class="muted small crumbs">${p.categoryPath.map((c, i) => `<a href="${catHref(p!.categoryPath.slice(0, i + 1))}">${esc(c)}</a>`).join(' › ')}</p>` : ''}
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
                <legend>Nome e número <span class="muted">(opcional)</span></legend>
                <div class="custom">
                  <div class="inputs">
                    <label>Nome<input name="pname" maxlength="15" placeholder="QUARESMA" class="upper" autocomplete="off"></label>
                    <label>Número<input name="pnumber" inputmode="numeric" pattern="[0-9]{1,2}" maxlength="2" placeholder="23" autocomplete="off"></label>
                  </div>
                  <div>
                    <div id="kitPrev">${kitSvg('', '')}</div>
                    <p class="kit-note">Pré-visualização</p>
                  </div>
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
  const numInput = app.querySelector<HTMLInputElement>('input[name="pnumber"]');
  const prev = app.querySelector<HTMLElement>('#kitPrev');
  let cor = { fill: '#1e6b4c', ink: '#ffffff' };
  const desenharKit = (): void => {
    if (prev) prev.innerHTML = kitSvg(nameInput?.value ?? '', numInput?.value ?? '', cor.fill, cor.ink);
  };
  if (prev) {
    void corDaCamisola(p.images[0] ?? '').then((c) => {
      if (c) { cor = c; desenharKit(); }
    });
  }
  nameInput?.addEventListener('input', () => {
    const pos = nameInput.selectionStart;
    nameInput.value = nameInput.value.toUpperCase();
    nameInput.setSelectionRange(pos, pos);
    desenharKit();
  });
  numInput?.addEventListener('input', () => {
    numInput.value = numInput.value.replace(/\D/g, '').slice(0, 2);
    desenharKit();
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
    desenharKit();
    toast('Adicionado ao carrinho.');
  });
}

/* ---------- carrinho / checkout ---------- */

function renderCart(): void {
  if (!cart.length) {
    app.innerHTML = `
      <section class="narrow-page">
        <h1>Carrinho</h1>
        <p class="empty">O carrinho está vazio. <a href="#/">Vai ao catálogo</a> e escolhe a tua camisola.</p>
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
        <p class="muted small">Não há pagamento online. Depois de registares a encomenda, falamos contigo com os dados de pagamento.</p>
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
      toast(`Encomenda #${orderCode(ref.id)} registada. Obrigado, craque!`);
      location.hash = '#/encomendas';
    } catch (err) {
      console.error(err);
      toast('Não foi possível registar a encomenda. Tenta outra vez.', 'err');
      btn.disabled = false;
    }
  });
}

/* ---------- encomendas do cliente ---------- */

async function renderOrders(): Promise<void> {
  app.innerHTML = `
    <section class="narrow-page">
      <h1>As minhas encomendas</h1>
      <div id="list">${loaderHtml('A carregar as tuas encomendas…')}</div>
    </section>`;
  const list = app.querySelector('#list')!;
  if (!user) return;
  try {
    const uid = user.uid;
    const snap = await aCarregar(() => getDocs(query(collection(db, 'orders'), where('uid', '==', uid))));
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
                <span class="status s-${o.status}">${STATUS_LABELS_CLIENTE[o.status]}</span>
              </header>
              ${o.total != null ? `<p class="order-total-line">Total: <b>${fmtEur(o.total)}</b>${o.extra ? ` <span class="muted small">(inclui ${o.extra < 0 ? 'desconto' : 'portes/outros'} de ${fmtEur(Math.abs(o.extra))})</span>` : ''}</p>` : ''}
              ${o.items
                .map(
                  (i) => `
                  <div class="line">
                    ${i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="">` : '<div class="ph"></div>'}
                    <div class="grow"><b>${esc(i.title)}</b>${itemDetails(i)}</div>
                    ${o.total != null && typeof i.price === 'number' ? `<span class="line-price">${i.qty > 1 ? `${i.qty} × ` : ''}${fmtEur(i.price)}</span>` : ''}
                  </div>`,
                )
                .join('')}
            </article>`,
          )
          .join('')
      : '<p class="empty">Ainda não fizeste nenhuma encomenda. <a href="#/">Vai ao catálogo</a></p>';
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
    const uid = user.uid;
    await ocupado((e as SubmitEvent).submitter ?? form.querySelector('button[type="submit"], button:not([type])'), async () => {
      try {
        await setDoc(doc(db, 'users', uid), next, { merge: true });
        profile = next;
        toast('Dados guardados.');
      } catch (err) {
        console.error(err);
        toast('Não foi possível guardar.', 'err');
      }
    });
  });
  app.querySelector('#pw')!.addEventListener('click', async (e) => {
    const email = user?.email;
    if (!email) return;
    await ocupado(e.currentTarget as HTMLElement, async () => {
      try {
        await sendPasswordResetEmail(auth, email);
        toast('Enviámos um link para o teu email.');
      } catch (err) {
        toast(authError(err), 'err');
      }
    });
  });
  app.querySelector('#logout')!.addEventListener('click', () => {
    location.hash = '#/';
    void signOut(auth);
  });
}

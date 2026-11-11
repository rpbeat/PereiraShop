import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uploadImage } from '../lib/storage';
import { SIZES_ADULT, SIZES_KIDS, type Patch, type Product } from '../lib/types';
import { esc, toast } from '../lib/ui';

/**
 * Importação em lote a partir de uma pasta local.
 *
 *   Pasta escolhida/
 *     Categoria/            ← opcional: usada como categoria
 *       Nome do artigo/     ← cada pasta com imagens = 1 artigo
 *         1.jpg 2.jpg …
 */

interface Draft {
  key: string;
  ref: string; // caminho relativo da pasta (guardado como supplierRef)
  title: string;
  category: string;
  files: File[];
  selected: boolean[];
  include: boolean;
  exists: boolean;
  status: '' | 'a enviar' | 'feito' | 'erro';
}

export interface ImportContext {
  app: HTMLElement;
  products: () => Product[];
  patches: () => Patch[];
  reloadProducts: () => Promise<void>;
}

const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;

let drafts: Draft[] = [];
let urls = new Map<File, string>();
let importing = false;
let maxImages = 8;

const cleanName = (s: string): string => s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
const byName = (a: File, b: File): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function thumb(f: File): string {
  let u = urls.get(f);
  if (!u) {
    u = URL.createObjectURL(f);
    urls.set(f, u);
  }
  return u;
}

function buildDrafts(files: File[], existing: Product[]): Draft[] {
  const groups = new Map<string, { title: string; category: string; files: File[] }>();
  for (const f of files) {
    if (!IMG_EXT.test(f.name) && !f.type.startsWith('image/')) continue;
    const parts = (f.webkitRelativePath || f.name).split('/');
    const dirs = parts.slice(0, -1); // [raiz, (categoria…), artigo]
    if (!dirs.length) continue;
    const album = dirs[dirs.length - 1]!;
    const category = dirs.length >= 3 ? dirs[dirs.length - 2]! : '';
    const ref = dirs.slice(1).join('/') || album;
    const g = groups.get(ref) ?? { title: cleanName(album), category: cleanName(category), files: [] };
    g.files.push(f);
    groups.set(ref, g);
  }
  const refs = new Set(existing.map((p) => p.supplierRef.toLowerCase()));
  const titles = new Set(existing.map((p) => p.title.toLowerCase()));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt', { numeric: true }))
    .map(([ref, g], k) => {
      const sorted = g.files.sort(byName);
      const exists = refs.has(ref.toLowerCase()) || titles.has(g.title.toLowerCase());
      return {
        key: String(k),
        ref,
        title: g.title,
        category: g.category,
        files: sorted,
        selected: sorted.map((_, i) => i < maxImages),
        include: !exists,
        exists,
        status: '',
      };
    });
}

export function renderImport(ctx: ImportContext): void {
  const { app } = ctx;
  const sizeBox = (s: string, on: boolean): string =>
    `<label class="size"><input type="checkbox" name="sizes" value="${esc(s)}" ${on ? 'checked' : ''}><span>${esc(s)}</span></label>`;
  const defaultSizes = ['S', 'M', 'L', 'XL', 'XXL'];

  app.innerHTML = `
    <section>
      <div class="toolbar"><h1>Importar artigos</h1></div>
      <form id="impForm" class="card form import-form">
        <p class="muted">Descarregue os álbuns do fornecedor para uma pasta no computador e escolha-a aqui.
          Cada subpasta com imagens passa a ser um artigo (nome da pasta = título).
          Se houver um nível acima, é usado como categoria.</p>
        <pre class="tree">Catálogo/                     ← pasta a escolher
  Clubes Portugueses/          ← categoria (opcional)
    Benfica 25-26 Principal/   ← artigo
      1.jpg  2.jpg  3.jpg</pre>
        <div class="row">
          <label class="btn primary file">Escolher pasta<input id="dir" type="file" webkitdirectory multiple hidden></label>
          <label class="narrow">Máx. imagens por artigo<input name="maxImages" type="number" min="1" max="30" value="${maxImages}"></label>
          <label>Categoria por omissão<input name="defCategory" list="impCats" placeholder="Usada quando a pasta não tem categoria"></label>
        </div>
        <datalist id="impCats">${[...new Set(ctx.products().map((p) => p.category).filter(Boolean))]
          .map((c) => `<option value="${esc(c)}">`)
          .join('')}</datalist>
        <fieldset>
          <legend>Valores aplicados a todos os artigos importados</legend>
          <p class="muted small">Adulto</p>
          <div class="sizes">${SIZES_ADULT.map((s) => sizeBox(s, defaultSizes.includes(s))).join('')}</div>
          <p class="muted small">Criança</p>
          <div class="sizes">${SIZES_KIDS.map((s) => sizeBox(s, false)).join('')}</div>
          <label class="check"><input type="checkbox" name="allowNameNumber" checked> Permitir nome e número</label>
          ${
            ctx.patches().length
              ? `<p class="muted small">Patches disponíveis:</p>
                 <div class="patches">${ctx
                   .patches()
                   .map(
                     (pt) => `<label class="patch"><input type="checkbox" name="patchIds" value="${esc(pt.id)}">
                       ${pt.imageUrl ? `<img src="${esc(pt.imageUrl)}" alt="">` : ''}<span>${esc(pt.name)}</span></label>`,
                   )
                   .join('')}</div>`
              : ''
          }
          <label class="check"><input type="checkbox" name="active"> Publicar logo na loja (senão ficam ocultos para rever)</label>
        </fieldset>
      </form>
      <div id="drafts"></div>
    </section>`;

  const form = app.querySelector<HTMLFormElement>('#impForm')!;
  const list = app.querySelector<HTMLElement>('#drafts')!;

  form.querySelector<HTMLInputElement>('input[name="maxImages"]')!.addEventListener('change', (e) => {
    maxImages = Math.min(30, Math.max(1, Number((e.target as HTMLInputElement).value) || 8));
    drafts.forEach((d) => (d.selected = d.files.map((_, i) => i < maxImages)));
    draw();
  });

  form.querySelector<HTMLInputElement>('#dir')!.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = new Map();
    drafts = buildDrafts([...(input.files ?? [])], ctx.products());
    input.value = '';
    if (!drafts.length) toast('Não encontrei imagens nessa pasta.', 'err');
    draw();
  });

  // Edição dos rascunhos (delegação)
  list.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const d = drafts.find((x) => x.key === el.closest<HTMLElement>('[data-k]')?.dataset.k);
    if (!d) return;
    if (el.name === 'title') d.title = el.value;
    if (el.name === 'category') d.category = el.value;
  });
  list.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'allDrafts') {
      drafts.forEach((d) => d.status !== 'feito' && (d.include = el.checked));
      draw();
      return;
    }
    const d = drafts.find((x) => x.key === el.closest<HTMLElement>('[data-k]')?.dataset.k);
    if (d && el.name === 'include') {
      d.include = el.checked;
      drawSummary();
    }
  });
  list.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-img],[data-run]');
    if (!t) return;
    if (t.dataset.run !== undefined) {
      void runImport();
      return;
    }
    const d = drafts.find((x) => x.key === t.closest<HTMLElement>('[data-k]')?.dataset.k);
    if (!d || importing) return;
    const i = Number(t.dataset.img);
    d.selected[i] = !d.selected[i];
    t.classList.toggle('off', !d.selected[i]);
    const count = t.closest('.draft')?.querySelector('.img-count');
    if (count) count.textContent = `${d.selected.filter(Boolean).length}/${d.files.length} imagens`;
  });

  function drawSummary(): void {
    const n = drafts.filter((d) => d.include && d.status !== 'feito').length;
    const bar = list.querySelector('.import-bar');
    if (!bar) return;
    bar.querySelector('.n')!.textContent = String(n);
    (bar.querySelector('[data-run]') as HTMLButtonElement).disabled = importing || n === 0;
  }

  function draw(): void {
    if (!drafts.length) {
      list.innerHTML = '';
      return;
    }
    const dup = drafts.filter((d) => d.exists).length;
    list.innerHTML = `
      <div class="card import-bar">
        <label class="check"><input type="checkbox" id="allDrafts" ${drafts.every((d) => d.include) ? 'checked' : ''}> Todos</label>
        <span><b class="n"></b> de ${drafts.length} artigos selecionados${dup ? ` · ${dup} já existem (desmarcados)` : ''}</span>
        <button class="btn primary" type="button" data-run>Importar</button>
      </div>
      <div class="drafts">${drafts.map(draftCard).join('')}</div>`;
    drawSummary();
  }

  function draftCard(d: Draft): string {
    const sel = d.selected.filter(Boolean).length;
    return `
      <article class="card draft ${d.include ? '' : 'skip'} ${d.status ? `st-${d.status.replace(' ', '-')}` : ''}" data-k="${d.key}">
        <div class="draft-head">
          <label class="check"><input type="checkbox" name="include" ${d.include ? 'checked' : ''} ${d.status === 'feito' ? 'disabled' : ''}></label>
          <input name="title" value="${esc(d.title)}" aria-label="Título" ${importing ? 'disabled' : ''}>
          <input name="category" value="${esc(d.category)}" list="impCats" placeholder="Categoria" aria-label="Categoria" ${importing ? 'disabled' : ''}>
          <span class="muted small img-count">${sel}/${d.files.length} imagens</span>
          ${d.exists ? '<span class="tag">Já existe</span>' : ''}
          ${d.status ? `<span class="tag ${d.status === 'feito' ? 'ok' : ''}">${d.status}</span>` : ''}
        </div>
        <div class="draft-imgs">${d.files
          .map((f, i) => `<button type="button" class="dimg ${d.selected[i] ? '' : 'off'}" data-img="${i}" title="${esc(f.name)}"><img loading="lazy" src="${thumb(f)}" alt=""></button>`)
          .join('')}</div>
        <p class="muted small">${esc(d.ref)} · clique numa imagem para a incluir/excluir; a primeira selecionada fica como principal.</p>
      </article>`;
  }

  async function runImport(): Promise<void> {
    const todo = drafts.filter((d) => d.include && d.status !== 'feito');
    if (!todo.length || importing) return;
    const fd = new FormData(form);
    const checked = new Set(fd.getAll('sizes').map(String));
    const sizes = [...SIZES_ADULT, ...SIZES_KIDS].filter((s) => checked.has(s));
    if (!sizes.length) return toast('Escolha pelo menos um tamanho.', 'err');
    const defCategory = String(fd.get('defCategory') ?? '').trim();
    const common = {
      sizes,
      allowNameNumber: fd.has('allowNameNumber'),
      patchIds: fd.getAll('patchIds').map(String),
      active: fd.has('active'),
    };

    importing = true;
    const leave = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    draw();
    let ok = 0;
    for (const d of todo) {
      const files = d.files.filter((_, i) => d.selected[i]);
      if (!files.length || !d.title.trim()) {
        d.status = 'erro';
        draw();
        continue;
      }
      d.status = 'a enviar';
      draw();
      try {
        const pid = doc(collection(db, 'products')).id;
        const images: string[] = [];
        // 3 em paralelo, mantendo a ordem
        for (let i = 0; i < files.length; i += 3) {
          const batch = files.slice(i, i + 3);
          const up = await Promise.all(batch.map((f, j) => uploadImage(`products/${pid}/${Date.now()}-${i + j}.jpg`, f)));
          images.push(...up);
        }
        await setDoc(doc(db, 'products', pid), {
          title: d.title.trim(),
          category: d.category.trim() || defCategory,
          supplierRef: d.ref,
          images,
          ...common,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        d.status = 'feito';
        d.include = false;
        ok++;
      } catch (err) {
        console.error(err);
        d.status = 'erro';
      }
      draw();
    }
    importing = false;
    window.removeEventListener('beforeunload', leave);
    await ctx.reloadProducts();
    draw();
    const failed = todo.length - ok;
    toast(failed ? `${ok} importados, ${failed} com erro.` : `${ok} artigos importados.`, failed ? 'err' : 'ok');
  }

  draw();
}

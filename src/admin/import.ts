import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uploadImage } from '../lib/storage';
import { SIZES_ADULT, SIZES_KIDS, type Patch, type Product } from '../lib/types';
import { esc, toast } from '../lib/ui';
import { caminhoDe, caminhoTexto, interpretar } from '../lib/nomes';
import { detetarPrincipal, prepararDetetor } from '../lib/fotoPrincipal';

/**
 * Importação em lote a partir de uma pasta local.
 *
 *   Pasta escolhida/
 *     Categoria/            ← opcional (ex.: Primeira Liga)
 *       Subcategoria/       ← opcional (ex.: Sporting CP)
 *         Nome do artigo/   ← cada pasta com imagens = 1 artigo
 *           001.jpg 002.jpg …
 *
 * O nome do fornecedor (inglês) é interpretado por lib/nomes.ts: título em português,
 * categoria por níveis (Liga › Clube › Tipo) e tamanhos indicados no título.
 */

interface Draft {
  key: string;
  ref: string; // caminho relativo da pasta (guardado como supplierRef)
  title: string; // título final (português, editável)
  path: string; // categoria final "Liga › Clube › Tipo" (editável)
  source: string; // nome original do fornecedor (pasta do artigo)
  catPath: string[]; // pastas entre a raiz e o artigo (ex.: ["Primeira Liga", "S.L. Benfica"])
  sizes: string[]; // tamanhos lidos do título
  files: File[];
  selected: boolean[];
  include: boolean;
  exists: boolean;
  status: '' | 'a detetar' | 'a enviar' | 'feito' | 'erro';
  frente: '' | 'a analisar' | 'detetada' | 'rever' | 'manual' | 'capa'; // deteção da foto principal
  /** .progresso.json do painel Yupoo (diz qual é a foto de capa do álbum). */
  progresso?: File;
}

export interface ImportContext {
  app: HTMLElement;
  products: () => Product[];
  patches: () => Patch[];
  reloadProducts: () => Promise<void>;
}

const IMG_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;
const PROGRESSO = '.progresso.json';

let drafts: Draft[] = [];
let urls = new Map<File, string>();
let importing = false;
let maxImages = 8;
let usarInterpretacao = true;
let usarTamanhosTitulo = true;
let detetarFrente = true;
let detecaoId = 0; // muda quando se escolhe outra pasta (cancela a deteção em curso)

/** Preenche título, categoria e tamanhos de um rascunho (interpretados ou tal como estão nas pastas). */
function preencher(d: Pick<Draft, 'title' | 'path' | 'source' | 'catPath' | 'sizes'>): void {
  if (usarInterpretacao) {
    const r = interpretar(d.source, d.catPath);
    d.title = r.titulo;
    d.path = caminhoTexto(r.categorias);
    d.sizes = r.tamanhos;
  } else {
    d.title = d.source;
    d.path = caminhoTexto(d.catPath);
    d.sizes = interpretar(d.source).tamanhos;
  }
}

// Retira o prefixo numérico dos scripts de download ("003_Benfica…" → "Benfica…")
const cleanName = (s: string): string =>
  s
    .replace(/^\d{1,4}_/, '') // prefixo dos scripts de download ("036_…")
    .replace(/[_]+/g, ' ')
    .replace(/\b(\d{2}) (\d{2})\b/g, '$1/$2') // época: "26 27" → "26/27" (o "/" não é permitido em pastas)
    .replace(/\s+/g, ' ')
    .trim();
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
  const groups = new Map<string, { title: string; catPath: string[]; files: File[] }>();
  const progressos = new Map<string, File>();
  for (const f of files) {
    if (f.name === PROGRESSO) {
      const dirs = (f.webkitRelativePath || f.name).split('/').slice(0, -1);
      progressos.set(dirs.slice(1).join('/') || dirs[dirs.length - 1] || '', f);
      continue;
    }
    if (!IMG_EXT.test(f.name) && !f.type.startsWith('image/')) continue;
    const parts = (f.webkitRelativePath || f.name).split('/');
    const dirs = parts.slice(0, -1); // [raiz, (categoria, subcategoria…), artigo]
    if (!dirs.length) continue;
    const album = dirs[dirs.length - 1]!;
    const catPath = dirs.slice(1, -1).map(cleanName).filter(Boolean);
    const ref = dirs.slice(1).join('/') || album;
    const g = groups.get(ref) ?? { title: cleanName(album), catPath, files: [] };
    g.files.push(f);
    groups.set(ref, g);
  }
  const refs = new Set(existing.map((p) => p.supplierRef.toLowerCase()));
  const titles = new Set(existing.flatMap((p) => [p.title.toLowerCase(), p.sourceTitle.toLowerCase()]).filter(Boolean));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt', { numeric: true }))
    .map(([ref, g], k) => {
      const sorted = g.files.sort(byName);
      const base = { title: '', path: '', source: g.title, catPath: g.catPath, sizes: [] as string[] };
      preencher(base);
      const exists = refs.has(ref.toLowerCase()) || titles.has(g.title.toLowerCase()) || titles.has(base.title.toLowerCase());
      return {
        key: String(k),
        ref,
        ...base,
        files: sorted,
        selected: sorted.map((_, i) => i < maxImages),
        include: !exists,
        exists,
        status: '',
        frente: '',
        progresso: progressos.get(ref),
      };
    });
}

function tornarPrincipal(d: Draft, i: number): void {
  const [f] = d.files.splice(i, 1);
  d.selected.splice(i, 1);
  d.files.unshift(f!);
  d.selected.unshift(true);
}

/**
 * Álbuns descarregados pelo painel Yupoo: o .progresso.json diz qual é a capa do álbum
 * (campo "principal", ex.: "007.jpg"). Essa foto passa a principal e o detetor não é preciso.
 */
async function aplicarCapas(lista: Draft[]): Promise<number> {
  let n = 0;
  await Promise.all(
    lista.map(async (d) => {
      if (!d.progresso || d.frente) return;
      try {
        const j = JSON.parse(await d.progresso.text()) as { principal?: string; principal_num?: string; feitas?: Record<string, string> };
        const nome = j.principal || (j.principal_num ? j.feitas?.[j.principal_num] : '') || '';
        const i = nome ? d.files.findIndex((f) => f.name.toLowerCase() === nome.toLowerCase()) : -1;
        if (i < 0) return;
        if (i > 0) tornarPrincipal(d, i);
        d.selected[0] = true;
        d.frente = 'capa';
        n++;
      } catch {
        /* progresso ilegível: segue para o detetor */
      }
    }),
  );
  return n;
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
        <p class="muted">Escolha a pasta do catálogo descarregado. Cada subpasta com imagens passa a ser um artigo.
          O nome do fornecedor é traduzido para português e a categoria é deduzida (Liga › Clube › Tipo);
          pode corrigir tudo antes de importar.</p>
        <pre class="tree">catalogo/                          ← pasta a escolher
  Primeira Liga/                   ← categoria (opcional)
    S.L. Benfica/                  ← subcategoria (opcional)
      Benfica 26-27 Home Jersey/   ← artigo
        001.jpg  002.jpg</pre>
        <div class="row">
          <label class="btn primary file">Escolher pasta<input id="dir" type="file" webkitdirectory multiple hidden></label>
          <label class="narrow">Máx. imagens por artigo<input name="maxImages" type="number" min="1" max="30" value="${maxImages}"></label>
          <label>Categoria por omissão<input name="defCategory" list="impCats" placeholder="Quando não for possível deduzir"></label>
        </div>
        <div class="row">
          <label class="check"><input type="checkbox" name="interpretar" ${usarInterpretacao ? 'checked' : ''}> Traduzir nomes e deduzir categorias</label>
          <label class="check"><input type="checkbox" name="tamTitulo" ${usarTamanhosTitulo ? 'checked' : ''}> Usar os tamanhos indicados no título (ex.: S-4XL, 16-28)</label>
          <label class="check"><input type="checkbox" name="frente" ${detetarFrente ? 'checked' : ''}> Detetar a foto principal (frente da camisola) nos artigos sem capa do Yupoo marcada</label>
        </div>
        <datalist id="impCats">${[...new Set(ctx.products().flatMap((p) => p.categoryPath.map((_, i) => caminhoTexto(p.categoryPath.slice(0, i + 1)))))]
          .sort((a, b) => a.localeCompare(b, 'pt'))
          .map((c) => `<option value="${esc(c)}">`)
          .join('')}</datalist>
        <fieldset>
          <legend>Valores aplicados a todos os artigos importados</legend>
          <p class="muted small">Tamanhos (usados nos artigos cujo título não indica tamanhos)</p>
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

  form.querySelector<HTMLInputElement>('input[name="interpretar"]')!.addEventListener('change', (e) => {
    usarInterpretacao = (e.target as HTMLInputElement).checked;
    drafts.forEach((d) => d.status !== 'feito' && preencher(d));
    draw();
  });
  form.querySelector<HTMLInputElement>('input[name="tamTitulo"]')!.addEventListener('change', (e) => {
    usarTamanhosTitulo = (e.target as HTMLInputElement).checked;
    draw();
  });

  form.querySelector<HTMLInputElement>('input[name="maxImages"]')!.addEventListener('change', (e) => {
    maxImages = Math.min(30, Math.max(1, Number((e.target as HTMLInputElement).value) || 8));
    drafts.forEach((d) => (d.selected = d.files.map((_, i) => i < maxImages)));
    draw();
  });

  form.querySelector<HTMLInputElement>('#dir')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = new Map();
    detecaoId++;
    const novos = buildDrafts([...(input.files ?? [])], ctx.products());
    drafts = novos;
    input.value = '';
    if (!drafts.length) toast('Não encontrei imagens nessa pasta.', 'err');
    // capa do Yupoo marcada pelo painel → foto principal (antes de mostrar, para não "saltar")
    const nCapas = await aplicarCapas(novos);
    if (drafts !== novos) return; // entretanto escolheu outra pasta
    draw();
    if (nCapas) toast(`Foto principal: capa do Yupoo em ${nCapas} de ${novos.length} artigos.`);
    if (detetarFrente) void detetarTodas();
  });

  form.querySelector<HTMLInputElement>('input[name="frente"]')!.addEventListener('change', (e) => {
    detetarFrente = (e.target as HTMLInputElement).checked;
    if (detetarFrente) void detetarTodas();
    else detecaoId++;
  });

  /** Escolhe a frente de cada artigo (por ordem) e passa-a para primeira foto. */
  async function detetarTodas(): Promise<void> {
    const meu = ++detecaoId;
    const alvo = drafts.filter((d) => d.files.length > 1 && d.status !== 'feito' && !d.frente);
    if (!alvo.length) return;
    const estado = (t: string): void => {
      const el = list.querySelector('.det-estado');
      if (el) el.textContent = t;
    };
    try {
      estado('A preparar o detetor de fotos (na 1.ª vez descarrega ~90 MB)…');
      await prepararDetetor((pct) => estado(`A descarregar o detetor de fotos: ${pct}%`));
      let k = 0;
      for (const d of alvo) {
        if (meu !== detecaoId) return;
        k++;
        estado(`A detetar a frente: ${k}/${alvo.length}`);
        d.frente = 'a analisar';
        redesenharCartao(d);
        const r = await detetarPrincipal(d.files.map(thumb));
        if (meu !== detecaoId) return;
        if (d.frente !== 'a analisar') continue; // o utilizador escolheu à mão entretanto
        if (r.indice > 0) tornarPrincipal(d, r.indice);
        d.frente = r.indice < 0 || !r.seguro ? 'rever' : 'detetada';
        redesenharCartao(d);
      }
      const rever = drafts.filter((d) => d.frente === 'rever').length;
      estado(rever ? `Frente detetada. ${rever} a rever (marcados a amarelo): duplo clique na foto certa.` : 'Frente detetada em todos os artigos.');
    } catch (err) {
      console.error(err);
      estado('Não foi possível usar o detetor de fotos (sem ligação?). Pode escolher a principal com duplo clique.');
      drafts.forEach((d) => d.frente === 'a analisar' && (d.frente = ''));
    } finally {
      drawSummary();
    }
  }

  function redesenharCartao(d: Draft): void {
    const el = list.querySelector(`.draft[data-k="${d.key}"]`);
    if (el) el.outerHTML = draftCard(d);
  }

  // duplo clique numa foto: passa a ser a principal
  list.addEventListener('dblclick', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-img]');
    const d = drafts.find((x) => x.key === t?.closest<HTMLElement>('[data-k]')?.dataset.k);
    if (!t || !d || importing) return;
    const i = Number(t.dataset.img);
    if (i > 0) tornarPrincipal(d, i);
    d.selected[0] = true;
    d.frente = 'manual';
    redesenharCartao(d);
  });

  // Edição dos rascunhos (delegação)
  list.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const d = drafts.find((x) => x.key === el.closest<HTMLElement>('[data-k]')?.dataset.k);
    if (!d) return;
    if (el.name === 'title') d.title = el.value;
    if (el.name === 'path') d.path = el.value;
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
        <span class="muted small det-estado"></span>
        <button class="btn primary" type="button" data-run>Importar</button>
      </div>
      <div class="drafts">${drafts.map(draftCard).join('')}</div>`;
    drawSummary();
  }

  function draftCard(d: Draft): string {
    const sel = d.selected.filter(Boolean).length;
    return `
      <article class="card draft ${d.include ? '' : 'skip'} ${d.status ? `st-${d.status.replace(' ', '-')}` : ''} ${d.frente === 'rever' ? 'rever' : ''}" data-k="${d.key}">
        <div class="draft-head">
          <label class="check"><input type="checkbox" name="include" ${d.include ? 'checked' : ''} ${d.status === 'feito' ? 'disabled' : ''}></label>
          <input name="title" value="${esc(d.title)}" aria-label="Título" ${importing ? 'disabled' : ''}>
          <input name="path" value="${esc(d.path)}" list="impCats" placeholder="Liga › Clube › Tipo" aria-label="Categoria" ${importing ? 'disabled' : ''}>
          <span class="muted small img-count">${sel}/${d.files.length} imagens</span>
          ${d.exists ? '<span class="tag">Já existe</span>' : ''}
          ${{ '': '', 'a analisar': '<span class="tag">A detetar a frente…</span>', detetada: '<span class="tag ok">Frente detetada</span>', rever: '<span class="tag warn">Confirmar a frente</span>', manual: '<span class="tag ok">Frente escolhida</span>', capa: '<span class="tag ok" title="Marcada pelo painel de download">Capa do Yupoo</span>' }[d.frente]}
          ${d.status ? `<span class="tag ${d.status === 'feito' ? 'ok' : ''}">${d.status}</span>` : ''}
        </div>
        <div class="draft-imgs">${d.files
          .map((f, i) => `<button type="button" class="dimg ${d.selected[i] ? '' : 'off'} ${i === 0 ? 'principal' : ''}" data-img="${i}" title="${esc(f.name)} (duplo clique: tornar principal)"><img loading="lazy" src="${thumb(f)}" alt=""></button>`)
          .join('')}</div>
        <p class="muted small">Original: <b>${esc(d.source)}</b>${
          usarTamanhosTitulo && d.sizes.length ? ` · Tamanhos: <b>${esc(d.sizes[0])}–${esc(d.sizes[d.sizes.length - 1])}</b>` : ''
        } · clique numa foto para a incluir/excluir; duplo clique para a tornar principal.</p>
      </article>`;
  }

  async function runImport(): Promise<void> {
    const todo = drafts.filter((d) => d.include && d.status !== 'feito');
    if (!todo.length || importing) return;
    const fd = new FormData(form);
    const checked = new Set(fd.getAll('sizes').map(String));
    const sizes = [...SIZES_ADULT, ...SIZES_KIDS].filter((s) => checked.has(s));
    const precisaComuns = todo.some((d) => !(usarTamanhosTitulo && d.sizes.length));
    if (precisaComuns && !sizes.length) return toast('Escolha pelo menos um tamanho (há artigos sem tamanhos no título).', 'err');
    const defCategory = String(fd.get('defCategory') ?? '').trim();
    const common = {
      allowNameNumber: fd.has('allowNameNumber'),
      patchIds: fd.getAll('patchIds').map(String),
      active: fd.has('active'),
    };

    importing = true;
    // a importação trata da deteção que faltar: pára a deteção em segundo plano para não correrem as duas
    detecaoId++;
    const leave = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    draw();
    let ok = 0;
    let detetorFalhou = false;
    for (const d of todo) {
      // garante que cada artigo passa pelo detetor da frente antes de enviar as fotos
      if (detetarFrente && !detetorFalhou && d.files.length > 1 && (d.frente === '' || d.frente === 'a analisar')) {
        d.status = 'a detetar';
        d.frente = 'a analisar';
        draw();
        try {
          const r = await detetarPrincipal(d.files.map(thumb));
          if (r.indice > 0) tornarPrincipal(d, r.indice);
          d.frente = r.indice < 0 || !r.seguro ? 'rever' : 'detetada';
        } catch (err) {
          console.error(err);
          detetorFalhou = true;
          d.frente = '';
          toast('Detetor de fotos indisponível: os restantes artigos seguem com a ordem original das fotos.', 'err');
        }
      }
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
        // miniatura da imagem principal para a grelha da loja
        const thumb = await uploadImage(`products/${pid}/thumb-${Date.now()}.jpg`, files[0]!, 'image/jpeg', 480).catch(() => '');
        const path = caminhoDe(d.path);
        const categoryPath = path.length ? path : defCategory ? caminhoDe(defCategory) : [];
        await setDoc(doc(db, 'products', pid), {
          title: d.title.trim(),
          category: categoryPath[0] ?? '',
          categoryPath,
          sourceTitle: d.source,
          supplierRef: d.ref,
          images,
          thumb,
          sizes: usarTamanhosTitulo && d.sizes.length ? d.sizes : sizes,
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

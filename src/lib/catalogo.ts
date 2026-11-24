/**
 * Índice do catálogo — controla os pedidos ao Firestore.
 *
 * Em vez de cada visita ler todos os artigos (1 leitura por artigo), o backoffice publica:
 *   catalog/meta            → { versao, partes, total, patches[], atualizado }
 *   catalogIndex/0, 1, …    → { itens: [{ id, t, p, i }] }   (até ~1500 artigos por documento)
 *
 * A loja lê catalog/meta (1 leitura). Se a versão for igual à que tem guardada no browser,
 * usa a cópia local; senão lê as partes (normalmente 1–3 leituras) e guarda-as.
 * Os detalhes de um artigo (fotos, tamanhos…) só são lidos quando o cliente o abre.
 */
import { doc, getDoc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';
import type { Patch, Product } from './types';

/** Artigo no índice (nomes curtos para poupar espaço: cada documento tem limite de 1 MB). */
export interface ItemIndice {
  id: string;
  t: string; // título
  p: string[]; // categorias [liga, clube, tipo]
  i: string; // miniatura (ou imagem principal)
}

export interface PatchIndice {
  id: string;
  name: string;
  imageUrl: string;
  order: number;
}

export interface Catalogo {
  versao: number;
  itens: ItemIndice[];
  patches: PatchIndice[];
  origem: 'cache' | 'servidor' | 'artigos';
}

const POR_PARTE = 1500;
const CHAVE_CACHE = 'pdc-catalogo-v1';

/** Assinatura simples do conteúdo (para não republicar o que não mudou). */
function assinatura(texto: string): string {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + texto.length.toString(36);
}

export function construirIndice(products: Product[], patches: Patch[]): { itens: ItemIndice[]; patches: PatchIndice[]; assinatura: string } {
  const itens = products
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, t: p.title, p: p.categoryPath, i: p.thumb || p.images[0] || '' }))
    .sort((a, b) => a.p.join('\u0000').localeCompare(b.p.join('\u0000'), 'pt') || a.t.localeCompare(b.t, 'pt'));
  const pts = patches
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl, order: p.order }));
  return { itens, patches: pts, assinatura: assinatura(JSON.stringify([itens, pts])) };
}

/** Backoffice: publica o índice se mudou. Devolve true se escreveu. */
export async function publicarIndice(db: Firestore, products: Product[], patches: Patch[], forcar = false): Promise<boolean> {
  const { itens, patches: pts, assinatura: sig } = construirIndice(products, patches);
  const metaRef = doc(db, 'catalog', 'meta');
  const atual = await getDoc(metaRef);
  const anterior = atual.exists() ? atual.data() : null;
  if (!forcar && anterior?.assinatura === sig) return false;

  const partes = Math.max(1, Math.ceil(itens.length / POR_PARTE));
  const versao = Date.now();
  const lote = writeBatch(db);
  for (let k = 0; k < partes; k++) {
    lote.set(doc(db, 'catalogIndex', String(k)), { versao, itens: itens.slice(k * POR_PARTE, (k + 1) * POR_PARTE) });
  }
  // partes que sobraram de uma publicação anterior maior
  for (let k = partes; k < Number(anterior?.partes ?? 0); k++) lote.delete(doc(db, 'catalogIndex', String(k)));
  lote.set(metaRef, { versao, partes, total: itens.length, patches: pts, assinatura: sig, atualizado: serverTimestamp() });
  await lote.commit();
  return true;
}

function lerCache(): Catalogo | null {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE_CACHE) || 'null');
    return c && Array.isArray(c.itens) ? { ...c, origem: 'cache' } : null;
  } catch {
    return null;
  }
}

function gravarCache(c: Catalogo): void {
  try {
    localStorage.setItem(CHAVE_CACHE, JSON.stringify({ versao: c.versao, itens: c.itens, patches: c.patches }));
  } catch {
    /* sem espaço / modo privado: fica só em memória */
  }
}

/**
 * Loja: carrega o catálogo gastando o mínimo de leituras.
 * Se ainda não houver índice publicado, lê os artigos diretamente (comportamento antigo).
 */
export async function carregarCatalogo(
  db: Firestore,
  fallback: () => Promise<{ itens: ItemIndice[]; patches: PatchIndice[] }>,
): Promise<Catalogo> {
  const meta = await getDoc(doc(db, 'catalog', 'meta'));
  if (!meta.exists()) {
    const f = await fallback();
    return { versao: 0, ...f, origem: 'artigos' };
  }
  const m = meta.data();
  const versao = Number(m.versao) || 0;
  const patches: PatchIndice[] = Array.isArray(m.patches) ? m.patches : [];
  const cache = lerCache();
  if (cache && cache.versao === versao) return { ...cache, patches, origem: 'cache' };

  const partes = Math.max(1, Number(m.partes) || 1);
  const snaps = await Promise.all(Array.from({ length: partes }, (_, k) => getDoc(doc(db, 'catalogIndex', String(k)))));
  const itens = snaps.flatMap((s) => (s.exists() && Array.isArray(s.data().itens) ? (s.data().itens as ItemIndice[]) : []));
  const c: Catalogo = { versao, itens, patches, origem: 'servidor' };
  gravarCache(c);
  return c;
}

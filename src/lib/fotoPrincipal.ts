/**
 * Deteção da foto principal (frente da camisola) com um modelo de visão (CLIP) a correr no browser.
 *
 * - Nada é enviado para servidores: o modelo (~90 MB) é descarregado uma vez e fica guardado no browser.
 * - A biblioteca só é carregada quando a ferramenta é usada (não pesa no site nem na loja).
 * - Cada foto é analisada uma vez e comparada com três conjuntos de descrições ("frente", "costas",
 *   "pormenor", "calções", "tabela de medidas"). A probabilidade de ser a frente é a média dos três.
 * - Testado com álbuns reais do fornecedor: acertou nos 5 de teste; a frente e as costas de equipamentos
 *   de criança ficam por vezes muito próximas — esses casos são marcados "a rever".
 */

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODELO = 'Xenova/clip-vit-base-patch32';

const OUTROS = [
  'a close-up photo of a football shirt detail, fabric, logo or badge',
  'a photo of football shorts or socks',
  'a size chart or table with text',
];
/** Em cada conjunto, a 1.ª descrição é a frente e a 2.ª as costas. */
const CONJUNTOS: string[][] = [
  ['a photo of the front of a football shirt on a mannequin', 'a photo of the back of a football shirt on a mannequin', ...OUTROS],
  ['the front of a football jersey showing the club crest and the sponsor logo on the chest', 'the back of a football jersey without a crest, plain back', ...OUTROS],
  ['a football jersey seen from the front, with crest, brand logo and sponsor on the chest, on a mannequin', 'a football jersey seen from behind, showing the back and the nape, on a mannequin', ...OUTROS],
];

/** Abaixo desta diferença entre as duas melhores fotos, o resultado deve ser confirmado. */
export const MARGEM_SEGURA = 0.05;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
interface Detetor {
  lib: Any;
  processor: Any;
  vision: Any;
  textos: Float32Array[]; // embeddings normalizados de todas as descrições, por conjunto
  escala: number;
}

let detetor: Promise<Detetor> | null = null;

const normalizar = (v: Float32Array): Float32Array => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
};

/** Prepara o modelo (descarrega na primeira vez). `progresso` recebe 0–100 durante o download. */
export function prepararDetetor(progresso?: (pct: number) => void): Promise<Detetor> {
  if (!detetor) {
    detetor = (async () => {
      const lib: Any = await import(/* @vite-ignore */ LIB);
      lib.env.allowLocalModels = false;
      const carregado = new Map<string, number>();
      const total = new Map<string, number>();
      const progress_callback = (e: Any): void => {
        if (e.status === 'progress' && e.file) {
          carregado.set(e.file, e.loaded ?? 0);
          total.set(e.file, e.total ?? 0);
          const t = [...total.values()].reduce((a, b) => a + b, 0);
          const c = [...carregado.values()].reduce((a, b) => a + b, 0);
          if (t) progresso?.(Math.round((c / t) * 100));
        }
      };
      const opts = { dtype: 'q8', progress_callback };
      const [tokenizer, textModel, processor, vision] = await Promise.all([
        lib.AutoTokenizer.from_pretrained(MODELO, { progress_callback }),
        lib.CLIPTextModelWithProjection.from_pretrained(MODELO, opts),
        lib.AutoProcessor.from_pretrained(MODELO, { progress_callback }),
        lib.CLIPVisionModelWithProjection.from_pretrained(MODELO, opts),
      ]);
      const todas = CONJUNTOS.flat();
      const { text_embeds } = await textModel(tokenizer(todas, { padding: true, truncation: true }));
      const dim = text_embeds.dims[1] as number;
      const dados = text_embeds.data as Float32Array;
      const textos = todas.map((_, i) => normalizar(dados.slice(i * dim, (i + 1) * dim)));
      return { lib, processor, vision, textos, escala: 100 };
    })();
    detetor.catch(() => {
      detetor = null; // permite tentar outra vez
    });
  }
  return detetor;
}

/** Probabilidade (0–1) de uma imagem ser a frente. `url`: http(s) ou blob:. */
async function probFrente(d: Detetor, url: string): Promise<number> {
  const img = await d.lib.RawImage.read(url);
  const { image_embeds } = await d.vision(await d.processor(img));
  const v = normalizar(image_embeds.data as Float32Array);
  const sims = d.textos.map((t) => t.reduce((s, x, i) => s + x * v[i]!, 0) * d.escala);
  let soma = 0;
  let k = 0;
  for (const conj of CONJUNTOS) {
    const logits = sims.slice(k, k + conj.length);
    k += conj.length;
    const max = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - max));
    soma += exps[0]! / exps.reduce((a, b) => a + b, 0);
  }
  return soma / CONJUNTOS.length;
}

export interface Resultado {
  indice: number; // foto escolhida (-1 se nenhuma parece a frente)
  pontos: number[];
  margem: number; // diferença para a 2.ª melhor
  seguro: boolean;
}

/** Analisa as fotos de um artigo e escolhe a frente. */
export async function detetarPrincipal(imagens: string[], minimo = 0.15): Promise<Resultado> {
  const d = await prepararDetetor();
  const pontos: number[] = [];
  for (const url of imagens) {
    try {
      pontos.push(await probFrente(d, url));
    } catch (err) {
      console.error('Falha a analisar', url, err);
      pontos.push(0);
    }
  }
  const ord = pontos.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
  const [p1, i1] = ord[0] ?? [0, -1];
  const margem = p1 - (ord[1]?.[0] ?? 0);
  const indice = p1 >= minimo ? i1 : -1;
  return { indice, pontos, margem, seguro: indice >= 0 && margem >= MARGEM_SEGURA };
}

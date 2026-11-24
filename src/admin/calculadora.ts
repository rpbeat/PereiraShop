import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { calcularTotal, fmtEur, lerEur, personalizado, precoSugerido, PRECOS_PADRAO, temPreco, type PrecosBase } from '../lib/precos';
import type { Order } from '../lib/types';
import { esc, toast } from '../lib/ui';

/**
 * Calculadora de preço de cada encomenda (no cartão da encomenda, no backoffice).
 * Cada artigo começa com o preço base (com/sem personalização); pode ser alterado à mão.
 * Os valores escritos ficam num rascunho em memória para não se perderem quando a lista
 * é redesenhada por atualizações em tempo real.
 */

let base: PrecosBase = { ...PRECOS_PADRAO };

interface Rascunho {
  precos: string[];
  extra: string;
}
const rascunhos = new Map<string, Rascunho>();
const abertas = new Set<string>();

export async function carregarPrecosBase(): Promise<void> {
  try {
    const s = await getDoc(doc(db, 'config', 'precos'));
    const d = s.data();
    if (d) base = { semPers: num(d.semPers, PRECOS_PADRAO.semPers), comPers: num(d.comPers, PRECOS_PADRAO.comPers) };
  } catch (err) {
    console.warn('preços base: a usar os valores por omissão', err);
  }
}
const num = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);
const txt = (n: number): string => String(n).replace('.', ',');

export const precosBase = (): PrecosBase => base;

/** Valores iniciais: os guardados (se a encomenda já tem preço) ou os sugeridos. */
function inicial(o: Order): Rascunho {
  const guardado = temPreco(o);
  return {
    precos: o.items.map((i) => txt(guardado && typeof i.price === 'number' ? i.price : precoSugerido(i, base))),
    extra: guardado && o.extra ? txt(o.extra) : '',
  };
}

function contas(o: Order, r: Rascunho): { precos: number[]; extra: number; total: number; valido: boolean } {
  const precos = r.precos.map(lerEur);
  const extra = r.extra.trim() ? lerEur(r.extra) : 0;
  const valido = precos.every((p) => isFinite(p) && p >= 0) && isFinite(extra);
  const total = valido ? calcularTotal(precos, o.items.map((i) => i.qty), extra) : NaN;
  return { precos, extra, total, valido };
}

/** Bloco da calculadora para o cartão da encomenda. */
export function calculadoraHtml(o: Order): string {
  const r = rascunhos.get(o.id) ?? inicial(o);
  const c = contas(o, r);
  const alterado = rascunhos.has(o.id);
  const resumo = temPreco(o)
    ? `<b>${fmtEur(o.total!)}</b>${alterado ? ' <span class="tag warn">Alterações por guardar</span>' : ''}`
    : `<span class="muted">Por definir</span>${alterado ? ' <span class="tag warn">Por guardar</span>' : ''}`;
  return `
    <details class="calc" data-calc="${o.id}" ${abertas.has(o.id) ? 'open' : ''}>
      <summary><span>Preço</span> ${resumo}</summary>
      <div class="calc-body">
        <table class="calc-tab">
          <tbody>
            ${o.items
              .map((i, k) => {
                const p = c.precos[k]!;
                return `
              <tr>
                <td class="calc-art">
                  <b>${esc(i.title)}</b>
                  <span class="muted small">${personalizado(i) ? 'Com personalização' : 'Sem personalização'}</span>
                </td>
                <td class="calc-qtd">${i.qty} ×</td>
                <td class="calc-preco">
                  <span class="eur-in"><input data-cpreco="${k}" value="${esc(r.precos[k] ?? '')}" inputmode="decimal" aria-label="Preço unitário" class="${isFinite(p) && p >= 0 ? '' : 'invalido'}"><i>€</i></span>
                  <span class="calc-rapido">
                    <button type="button" class="link" data-crapido="${k}" data-v="${base.semPers}">${fmtEur(base.semPers)}</button>
                    <button type="button" class="link" data-crapido="${k}" data-v="${base.comPers}">${fmtEur(base.comPers)}</button>
                  </span>
                </td>
                <td class="calc-sub" data-csub="${k}">${isFinite(p) ? fmtEur(p * i.qty) : '—'}</td>
              </tr>`;
              })
              .join('')}
            <tr class="calc-extra">
              <td colspan="2"><b>Portes / ajuste</b><span class="muted small">Negativo para desconto</span></td>
              <td class="calc-preco"><span class="eur-in"><input data-cextra value="${esc(r.extra)}" inputmode="decimal" placeholder="0" aria-label="Portes ou ajuste" class="${isFinite(c.extra) ? '' : 'invalido'}"><i>€</i></span></td>
              <td></td>
            </tr>
          </tbody>
          <tfoot>
            <tr><td colspan="3">Total</td><td class="calc-total" data-ctotal>${c.valido ? fmtEur(c.total) : '—'}</td></tr>
          </tfoot>
        </table>
        <div class="btns">
          <button class="btn primary small" data-cguardar="${o.id}">${temPreco(o) ? 'Guardar novo preço' : 'Guardar preço'}</button>
          <button class="btn ghost small" data-crepor="${o.id}">Repor preços base</button>
          ${temPreco(o) ? `<button class="btn ghost small" data-climpar="${o.id}">Remover preço</button>` : ''}
        </div>
        <p class="muted small">Depois de guardar, o cliente vê o total em "As minhas encomendas" e na imagem de confirmação.</p>
      </div>
    </details>`;
}

/** Liga os eventos da calculadora (uma vez). */
export function ligarCalculadora(app: HTMLElement, getOrders: () => Order[], redesenhar: () => void): void {
  const ordem = (el: Element | null): Order | undefined => {
    const id = el?.closest<HTMLElement>('[data-calc]')?.dataset.calc;
    return id ? getOrders().find((o) => o.id === id) : undefined;
  };
  const atualizarNumeros = (box: HTMLElement, o: Order, r: Rascunho): void => {
    const c = contas(o, r);
    o.items.forEach((i, k) => {
      const p = c.precos[k]!;
      const sub = box.querySelector(`[data-csub="${k}"]`);
      if (sub) sub.textContent = isFinite(p) ? fmtEur(p * i.qty) : '—';
      box.querySelector(`[data-cpreco="${k}"]`)?.classList.toggle('invalido', !(isFinite(p) && p >= 0));
    });
    box.querySelector('[data-cextra]')?.classList.toggle('invalido', !isFinite(c.extra));
    const tot = box.querySelector('[data-ctotal]');
    if (tot) tot.textContent = c.valido ? fmtEur(c.total) : '—';
  };

  // o evento "toggle" não sobe na árvore: apanha-se na fase de captura
  app.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      const id = d.dataset?.calc;
      if (!id) return;
      if (d.open) abertas.add(id);
      else abertas.delete(id);
    },
    true,
  );

  app.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const o = ordem(el);
    if (!o || !(el.dataset.cpreco !== undefined || el.dataset.cextra !== undefined)) return;
    const r = rascunhos.get(o.id) ?? inicial(o);
    if (el.dataset.cpreco !== undefined) r.precos[Number(el.dataset.cpreco)] = el.value;
    else r.extra = el.value;
    rascunhos.set(o.id, r);
    atualizarNumeros(el.closest<HTMLElement>('[data-calc]')!, o, r);
  });

  app.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-crapido],[data-crepor],[data-cguardar],[data-climpar]');
    if (!t) return;
    const o = ordem(t);
    if (!o) return;

    if (t.dataset.crapido !== undefined) {
      const r = rascunhos.get(o.id) ?? inicial(o);
      r.precos[Number(t.dataset.crapido)] = txt(Number(t.dataset.v));
      rascunhos.set(o.id, r);
      redesenhar();
      return;
    }
    if (t.dataset.crepor !== undefined) {
      rascunhos.set(o.id, { precos: o.items.map((i) => txt(precoSugerido(i, base))), extra: rascunhos.get(o.id)?.extra ?? '' });
      redesenhar();
      return;
    }

    const btn = t as HTMLButtonElement;
    if (t.dataset.climpar !== undefined) {
      if (!confirm('Remover o preço desta encomenda? O cliente deixa de ver o total.')) return;
      btn.disabled = true;
      try {
        await updateDoc(doc(db, 'orders', o.id), {
          items: o.items.map((i) => ({ ...i, price: null })),
          extra: 0,
          total: null,
          updatedAt: serverTimestamp(),
        });
        rascunhos.delete(o.id);
        toast('Preço removido.');
        redesenhar();
      } catch (err) {
        console.error(err);
        toast('Não foi possível remover o preço.', 'err');
        btn.disabled = false;
      }
      return;
    }

    // guardar
    const r = rascunhos.get(o.id) ?? inicial(o);
    const c = contas(o, r);
    if (!c.valido) {
      toast('Há preços inválidos. Usa números, por exemplo 25 ou 22,50.', 'err');
      return;
    }
    btn.disabled = true;
    try {
      await updateDoc(doc(db, 'orders', o.id), {
        items: o.items.map((i, k) => ({ ...i, price: c.precos[k] })),
        extra: c.extra,
        total: c.total,
        updatedAt: serverTimestamp(),
      });
      rascunhos.delete(o.id);
      toast(`Preço guardado: ${fmtEur(c.total)}.`);
      redesenhar();
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar o preço.', 'err');
      btn.disabled = false;
    }
  });
}

/** Painel "Preços base" (na página de encomendas). */
export function precosBaseHtml(): string {
  return `
    <details class="card precos-base">
      <summary>Preços base: <b>${fmtEur(base.semPers)}</b> sem personalização · <b>${fmtEur(base.comPers)}</b> com personalização</summary>
      <form id="precosBase" class="precos-base-form">
        <label>Sem personalização <span class="eur-in"><input name="semPers" value="${txt(base.semPers)}" inputmode="decimal" required><i>€</i></span></label>
        <label>Com personalização <span class="eur-in"><input name="comPers" value="${txt(base.comPers)}" inputmode="decimal" required><i>€</i></span></label>
        <button class="btn primary small" type="submit">Guardar preços base</button>
        <p class="muted small">Com personalização = tem nome, número ou patches. Só afeta as sugestões das encomendas ainda sem preço.</p>
      </form>
    </details>`;
}

export function ligarPrecosBase(app: HTMLElement, depois: () => void): void {
  const form = app.querySelector<HTMLFormElement>('#precosBase');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const novo = { semPers: lerEur(String(fd.get('semPers'))), comPers: lerEur(String(fd.get('comPers'))) };
    if (!(novo.semPers >= 0 && novo.comPers >= 0)) {
      toast('Preços inválidos.', 'err');
      return;
    }
    try {
      await setDoc(doc(db, 'config', 'precos'), { ...novo, updatedAt: serverTimestamp() });
      base = novo;
      // os rascunhos ainda não guardados ficam como estão; as encomendas sem preço passam a sugerir os novos valores
      toast('Preços base guardados.');
      depois();
    } catch (err) {
      console.error(err);
      toast('Não foi possível guardar os preços base.', 'err');
    }
  });
}

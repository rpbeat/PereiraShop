import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { emailContaAprovadaMsg, emailEncomendaMsg, type MensagemEmail, type TipoEmailEncomenda } from '../lib/emailTemplates';
import { db } from '../lib/firebase';
import type { Order } from '../lib/types';
import { orderCode, toast } from '../lib/ui';

/**
 * Emails para clientes através da extensão "Trigger Email from Firestore":
 * o backoffice cria um documento em mail/ e a extensão envia-o por SMTP,
 * escrevendo o resultado em delivery.state (PENDING → PROCESSING → SUCCESS | ERROR).
 */

async function porNaFila(to: string, message: MensagemEmail, extra: Record<string, unknown>): Promise<string> {
  const ref = await addDoc(collection(db, 'mail'), { to, message, ...extra, criadoEm: serverTimestamp() });
  return ref.id;
}

/** Coloca na fila o email "conta aprovada". Devolve o id do pedido de envio. */
export function emailContaAprovada(email: string, nome: string): Promise<string> {
  return porNaFila(email, emailContaAprovadaMsg(nome), { tipo: 'conta-aprovada' });
}

/** Email ao cliente sobre o estado da encomenda (o `o` já deve ter o estado novo). */
export function emailEstadoEncomenda(o: Order, tipo: TipoEmailEncomenda = o.status): Promise<string> {
  return porNaFila(o.email, emailEncomendaMsg(o, tipo), { tipo: `encomenda-${tipo}`, encomenda: o.id });
}

/**
 * Pede o email do novo estado e acompanha o envio. Não falha a operação principal:
 * se o pedido não puder ser criado, só avisa.
 */
export async function avisarClienteEstado(o: Order): Promise<void> {
  if (!o.email) {
    toast(`A encomenda #${orderCode(o.id)} não tem email do cliente: não foi enviado aviso.`, 'err');
    return;
  }
  try {
    const id = await emailEstadoEncomenda(o);
    vigiarEnvio(id, o.email, 'Email do novo estado');
  } catch (err) {
    console.error(err);
    toast('Estado alterado, mas não foi possível pedir o envio do email ao cliente.', 'err');
  }
}

/** Acompanha o envio durante uns segundos e avisa do resultado. */
export function vigiarEnvio(id: string, para: string, oQue = 'Email de aprovação'): void {
  let fim = false;
  const parar = onSnapshot(
    doc(db, 'mail', id),
    (s) => {
      const estado = s.get('delivery.state') as string | undefined;
      if (estado === 'SUCCESS') {
        terminar();
        toast(`${oQue} enviado para ${para}.`);
      } else if (estado === 'ERROR') {
        terminar();
        toast(`O email para ${para} falhou: ${s.get('delivery.error') ?? 'erro no envio'}.`, 'err');
      }
    },
    () => terminar(),
  );
  const espera = setTimeout(() => {
    if (fim) return;
    terminar();
    toast(`${oQue} para ${para} ainda não saiu. Confirma que a extensão "Trigger Email" está ativa (ver README).`, 'err');
  }, 45_000);
  function terminar(): void {
    fim = true;
    clearTimeout(espera);
    parar();
  }
}

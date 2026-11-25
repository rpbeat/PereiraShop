import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { esc, toast } from '../lib/ui';

/**
 * Emails para clientes através da extensão "Trigger Email from Firestore":
 * o backoffice cria um documento em mail/ e a extensão envia-o por SMTP,
 * escrevendo o resultado em delivery.state (PENDING → PROCESSING → SUCCESS | ERROR).
 */

const SITE = (): string => `${location.origin}/`;

function moldura(titulo: string, corpo: string): string {
  return `<!doctype html><html lang="pt-PT"><body style="margin:0;background:#F2F5F1;font-family:Arial,Helvetica,sans-serif;color:#13231C">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F5F1;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td style="background:#0F3D2E;padding:22px 28px;color:#ffffff">
        <div style="font-size:26px;font-weight:800;letter-spacing:.01em">Pé de Chumbo</div>
        <div style="font-size:14px;color:#C9A54B;margin-top:2px">${esc(titulo)}</div>
      </td></tr>
      <tr><td style="padding:26px 28px;font-size:16px;line-height:1.55">${corpo}</td></tr>
      <tr><td style="padding:16px 28px 24px;font-size:12px;color:#5d6b64;border-top:1px solid #DCE8DE">
        Recebeste este email porque criaste conta na loja Pé de Chumbo.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/** Coloca na fila o email "conta aprovada". Devolve o id do pedido de envio. */
export async function emailContaAprovada(email: string, nome: string): Promise<string> {
  const primeiro = nome.trim().split(/\s+/)[0] || '';
  const ola = primeiro ? `Olá ${primeiro},` : 'Olá,';
  const ref = await addDoc(collection(db, 'mail'), {
    to: email,
    message: {
      subject: 'A tua conta Pé de Chumbo foi aprovada',
      text: `${ola}\n\nA tua conta na Pé de Chumbo foi aprovada. Já podes entrar com o teu email e palavra-passe, escolher a camisola, o nome e o número.\n\n${SITE()}\n\nEm campo podes ser um desastre, mas pelo menos vais bem vestido.\nPé de Chumbo`,
      html: moldura(
        'Conta aprovada',
        `<p style="margin:0 0 14px">${esc(ola)}</p>
         <p style="margin:0 0 14px">A tua conta na <b>Pé de Chumbo</b> foi aprovada. Já podes entrar com o teu email e palavra-passe, escolher a camisola, o nome e o número.</p>
         <p style="margin:22px 0"><a href="${SITE()}" style="background:#1E6B4C;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">Entrar na loja</a></p>
         <p style="margin:0;color:#5d6b64">Em campo podes ser um desastre, mas pelo menos vais bem vestido.</p>`,
      ),
    },
    tipo: 'conta-aprovada',
    criadoEm: serverTimestamp(),
  });
  return ref.id;
}

/** Acompanha o envio durante uns segundos e avisa do resultado. */
export function vigiarEnvio(id: string, para: string): void {
  let fim = false;
  const parar = onSnapshot(
    doc(db, 'mail', id),
    (s) => {
      const estado = s.get('delivery.state') as string | undefined;
      if (estado === 'SUCCESS') {
        terminar();
        toast(`Email de aprovação enviado para ${para}.`);
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
    toast('O email de aprovação ainda não saiu. Confirma que a extensão "Trigger Email" está instalada (ver README).', 'err');
  }, 45_000);
  function terminar(): void {
    fim = true;
    clearTimeout(espera);
    parar();
  }
}

import type { DocumentData, Timestamp } from 'firebase/firestore';

export interface Product {
  id: string;
  title: string;
  category: string;
  /** URLs no Firebase Storage. A primeira é a principal (vai na mensagem ao fornecedor). */
  images: string[];
  sizes: string[];
  allowNameNumber: boolean;
  /** Patches que o cliente pode escolher para este artigo. */
  patchIds: string[];
  active: boolean;
  /** Link do álbum ou código no fornecedor (uso interno). */
  supplierRef: string;
  createdAt: Timestamp | null;
}

export interface Patch {
  id: string;
  name: string;
  imageUrl: string;
  active: boolean;
  order: number;
}

export interface OrderItem {
  productId: string;
  title: string;
  imageUrl: string;
  size: string;
  name: string;
  number: string;
  /** Nomes dos patches escolhidos (guardados por nome para a encomenda não mudar se o patch for editado). */
  patches: string[];
  qty: number;
  notes: string;
  supplierSent: boolean;
}

export interface CartItem extends OrderItem {
  key: string;
}

export type OrderStatus = 'pendente' | 'paga' | 'encomendada' | 'enviada' | 'entregue' | 'cancelada';

export const STATUSES: OrderStatus[] = ['pendente', 'paga', 'encomendada', 'enviada', 'entregue', 'cancelada'];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pendente: 'Pendente',
  paga: 'Paga',
  encomendada: 'Encomendada ao fornecedor',
  enviada: 'Enviada',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export interface Customer {
  name: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
}

export interface Order {
  id: string;
  uid: string;
  email: string;
  customer: Customer;
  items: OrderItem[];
  notes: string;
  status: OrderStatus;
  createdAt: Timestamp | null;
}

export const SIZES_ADULT = ['S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
export const SIZES_KIDS = ['16', '18', '20', '22', '24', '26', '28'];

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

export const emptyCustomer = (): Customer => ({ name: '', phone: '', address: '', postalCode: '', city: '' });

export function toCustomer(d: DocumentData | undefined): Customer {
  return {
    name: str(d?.name),
    phone: str(d?.phone),
    address: str(d?.address),
    postalCode: str(d?.postalCode),
    city: str(d?.city),
  };
}

export function toProduct(id: string, d: DocumentData): Product {
  return {
    id,
    title: str(d.title),
    category: str(d.category),
    images: strArr(d.images),
    sizes: strArr(d.sizes),
    allowNameNumber: d.allowNameNumber !== false,
    patchIds: strArr(d.patchIds),
    active: d.active !== false,
    supplierRef: str(d.supplierRef),
    createdAt: d.createdAt ?? null,
  };
}

export function toPatch(id: string, d: DocumentData): Patch {
  return {
    id,
    name: str(d.name),
    imageUrl: str(d.imageUrl),
    active: d.active !== false,
    order: typeof d.order === 'number' ? d.order : 0,
  };
}

export function toOrderItem(d: DocumentData): OrderItem {
  return {
    productId: str(d.productId),
    title: str(d.title),
    imageUrl: str(d.imageUrl),
    size: str(d.size),
    name: str(d.name),
    number: str(d.number),
    patches: strArr(d.patches),
    qty: typeof d.qty === 'number' && d.qty > 0 ? d.qty : 1,
    notes: str(d.notes),
    supplierSent: d.supplierSent === true,
  };
}

export function toOrder(id: string, d: DocumentData): Order {
  const status = STATUSES.includes(d.status) ? (d.status as OrderStatus) : 'pendente';
  return {
    id,
    uid: str(d.uid),
    email: str(d.email),
    customer: toCustomer(d.customer),
    items: Array.isArray(d.items) ? d.items.map(toOrderItem) : [],
    notes: str(d.notes),
    status,
    createdAt: d.createdAt ?? null,
  };
}

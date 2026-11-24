import type { DocumentData, Timestamp } from 'firebase/firestore';

export interface Product {
  id: string;
  title: string;
  /** Categoria de topo (= categoryPath[0]); mantida por compatibilidade. */
  category: string;
  /** Categorias por níveis, ex.: ["Liga Portugal", "Sporting", "Crianças"]. */
  categoryPath: string[];
  /** Título original do fornecedor (antes da tradução). */
  sourceTitle: string;
  /** URLs no Firebase Storage. A primeira é a principal (vai na mensagem ao fornecedor). */
  images: string[];
  /** Miniatura da imagem principal (~480 px) para a grelha do catálogo; vazio se ainda não houver. */
  thumb: string;
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
  /** Preço unitário definido no backoffice (só conta quando a encomenda tem total). */
  price?: number | null;
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

/** Como o cliente vê o estado (na loja e na confirmação): "pendente" aparece como "Em análise". */
export const STATUS_LABELS_CLIENTE: Record<OrderStatus, string> = { ...STATUS_LABELS, pendente: 'Em análise' };

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
  /** Portes ou ajuste (negativo = desconto), definido no backoffice. */
  extra: number;
  /** Total definido no backoffice; null enquanto o preço não foi definido. */
  total: number | null;
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
    categoryPath: (() => {
      const cp = strArr(d.categoryPath).filter(Boolean);
      return cp.length ? cp : str(d.category) ? [str(d.category)] : [];
    })(),
    sourceTitle: str(d.sourceTitle),
    images: strArr(d.images),
    thumb: str(d.thumb),
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
    price: typeof d.price === 'number' ? d.price : null,
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
    extra: typeof d.extra === 'number' ? d.extra : 0,
    total: typeof d.total === 'number' ? d.total : null,
  };
}

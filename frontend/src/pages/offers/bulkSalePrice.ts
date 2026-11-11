// Sale prices for several products at once: one POST /offers per product,
// one after another, each independent (no rollback). POST /offers isn't
// idempotent, so a request whose answer was lost is never resent blindly:
//
// * Before anything is sent, an EXHAUSTIVE snapshot of every existing sale
//   price is taken (every page of the unified list, type product_price),
//   indexed by the real product_id. Incomplete → nothing is sent.
// * Created (201)       → never sent again.
// * Rejected (4xx)      → the server answered, nothing was created → may be retried.
// * Lost (no answer / 5xx) → a fresh exhaustive listing is compared with the
//   snapshot: no new sale price for that product → "not created" (may be
//   retried); any new one, or a listing that fails → UNRESOLVED: never
//   retried until the employee decides.
//
// The API is injected, so this runs under `node --test`.
import type { Promotion } from '../../lib/api';

export type ListPage = (offset: number, limit: number) => Promise<{ items: Promotion[]; total: number }>;

export const SNAPSHOT_PAGE = 100;

export class IncompleteSnapshot extends Error {}

export interface SaleSnapshot {
  /** product_id → ids of its sale prices. */
  byProduct: Map<string, Set<string>>;
  rows: Map<string, Promotion>;
  total: number;
}

/** Every sale price, page by page. Throws IncompleteSnapshot when a page
 * fails, the total moves between pages, or the rows don't add up. */
export async function loadSaleSnapshot(listPage: ListPage): Promise<SaleSnapshot> {
  const rows = new Map<string, Promotion>();
  let total: number | null = null;
  let offset = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    let page: { items: Promotion[]; total: number };
    try {
      page = await listPage(offset, SNAPSHOT_PAGE);
    } catch {
      throw new IncompleteSnapshot('page');
    }
    if (total === null) total = page.total;
    else if (page.total !== total) throw new IncompleteSnapshot('moved');
    for (const p of page.items) {
      if (p.source !== 'product_offer') throw new IncompleteSnapshot('type');
      rows.set(p.id, p);
    }
    offset += SNAPSHOT_PAGE;
    if (offset >= total) break;
    if (!page.items.length) throw new IncompleteSnapshot('short');
  }
  if (total === null || rows.size !== total) throw new IncompleteSnapshot('count');
  const byProduct = new Map<string, Set<string>>();
  for (const p of rows.values()) {
    const pid = String((p.config as Record<string, unknown>).product_id);
    if (!byProduct.has(pid)) byProduct.set(pid, new Set());
    byProduct.get(pid)!.add(p.id);
  }
  return { byProduct, rows, total };
}

export type ItemStatus = 'pending' | 'saving' | 'checking' | 'created' | 'rejected' | 'not_created' | 'unresolved';

export interface BulkItem {
  productId: string;
  productName: string;
  payload: { product_id: string; title: string; offer_price: number; expires_at: string | null; is_active: boolean };
  status: ItemStatus;
  offerId?: string;
  message?: string;
  /** Unresolved: new sale prices of this product found after the lost answer. */
  candidates?: Promotion[];
}

export interface BulkDeps {
  create: (payload: BulkItem['payload']) => Promise<{ id: string }>;
  listPage: ListPage;
  messageOf: (err: unknown) => string;
}

/** The server answered with a client error: nothing was created. */
export function isRejection(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

export const RETRYABLE: ItemStatus[] = ['pending', 'rejected', 'not_created'];

/**
 * Sends every item whose status is pending / rejected / not_created, in
 * order, one at a time. Created and unresolved items are never sent.
 * `known` — product_id → sale price ids that are NOT this batch's (the
 * snapshot, plus candidates the employee said aren't hers); it grows as
 * the employee resolves items.
 */
export async function runBulk(items: BulkItem[], deps: BulkDeps, known: Map<string, Set<string>>, onUpdate: (items: BulkItem[]) => void): Promise<BulkItem[]> {
  let list = items.map((i) => ({ ...i }));
  const set = (i: number, patch: Partial<BulkItem>) => {
    list = list.map((x, j) => (j === i ? { ...x, ...patch } : x));
    onUpdate(list);
  };
  for (let i = 0; i < list.length; i++) {
    if (!RETRYABLE.includes(list[i].status)) continue;
    set(i, { status: 'saving', message: undefined, candidates: undefined });
    try {
      const created = await deps.create(list[i].payload);
      set(i, { status: 'created', offerId: created.id });
      continue;
    } catch (err) {
      if (isRejection(err)) {
        set(i, { status: 'rejected', message: deps.messageOf(err) });
        continue;
      }
    }
    // The answer was lost: was it created anyway?
    set(i, { status: 'checking' });
    try {
      const fresh = await loadSaleSnapshot(deps.listPage);
      const pid = list[i].productId;
      const before = known.get(pid) ?? new Set<string>();
      const createdHere = new Set(list.filter((x) => x.status === 'created' && x.offerId).map((x) => x.offerId!));
      const fresher = [...(fresh.byProduct.get(pid) ?? [])].filter((id) => !before.has(id) && !createdHere.has(id));
      if (!fresher.length) set(i, { status: 'not_created', message: 'ما اتعملش — تقدري تبعتيه تاني' });
      else set(i, { status: 'unresolved', candidates: fresher.map((id) => fresh.rows.get(id)!), message: 'مش متأكدين إن العرض اتعمل — راجعيه قبل ما تبعتيه تاني' });
    } catch {
      set(i, { status: 'unresolved', candidates: [], message: 'تعذر التحقق إن العرض اتعمل — راجعي قائمة العروض قبل ما تبعتيه تاني' });
    }
  }
  return list;
}

/** The employee checked an unresolved product: it WAS created (one of the
 * candidates) — it is never sent again. */
export function confirmCreated(items: BulkItem[], productId: string, offerId?: string): BulkItem[] {
  return items.map((x) => (x.productId === productId && x.status === 'unresolved'
    ? { ...x, status: 'created' as const, offerId: offerId ?? x.candidates?.[0]?.id, message: 'اتأكدتي إنه اتعمل' } : x));
}

/** The employee checked an unresolved product: it was NOT created — the
 * candidates (if any) aren't hers, so they join `known` and the product
 * can be sent again by the next retry (never automatically). */
export function confirmNotCreated(items: BulkItem[], productId: string, known: Map<string, Set<string>>): BulkItem[] {
  return items.map((x) => {
    if (x.productId !== productId || x.status !== 'unresolved') return x;
    const ids = known.get(productId) ?? new Set<string>();
    for (const c of x.candidates ?? []) ids.add(c.id);
    known.set(productId, ids);
    return { ...x, status: 'not_created' as const, candidates: undefined, message: 'هيتبعت تاني لما تضغطي «حاولي تاني»' };
  });
}

export function knownFrom(snapshot: SaleSnapshot): Map<string, Set<string>> {
  return new Map([...snapshot.byProduct].map(([k, v]) => [k, new Set(v)]));
}

// In-memory stand-in for the Prisma transaction client, plus an order-save helper that runs the
// SAME ledger code the routes run (syncCollections / syncShipMovements / reservation sync).
// It exercises the real accounting/inventory logic; it does not exercise Postgres, Express or auth.
import type { Prisma } from '@prisma/client';
import type { InventoryMovement, ModelProduction, OrderCancellation, ReadyStock, ReturnItem, Sale, ShippingCollection } from '@prisma/client';
import { collectionDate, loadStockContext, syncCollections, syncShipMovements } from '../src/services/orderLedgers';
import {
  effectiveSales, effectiveStatus, STATUS_CANCELED, computeStockPositions, hasLineReturns, holdsGoodsOutside, increasingKeys, isStockDeducting, outsideSlots, reservedSyncUpdates, validateShipment, valueStockRow,
  type CancelDisposition, type Slot,
} from '../src/services/readyStockPositions';
import { markReopened, recordCancellation, shippedSnapshot, updateDisposition, cancelledObligations, refundsByOrderNumber, refundsFor } from '../src/services/orderCancellation';
import { computeDashboardCashFlow, computeMoneyOwedToUs } from '../src/services/financialMetrics';
import { costOfGoodsShipped, returnsCostCredit, type MovementRow } from '../src/services/inventoryMovements';
import { FuzzyKeyIndex } from '../src/utils/textMatch';
import { ledgerTotal } from '../src/services/shippingCollections';
import { summarizeMissingStock } from '../src/services/missingStock';

type Tx = Prisma.TransactionClient;

export class World {
  sales: Sale[] = [];
  readyStock: ReadyStock[] = [];
  modelProds: ModelProduction[] = [];
  returns: ReturnItem[] = [];
  collections: ShippingCollection[] = [];
  movements: InventoryMovement[] = [];
  cancellations: OrderCancellation[] = [];
  private ids = { sale: 1, col: 1, mov: 1, canc: 1, ret: 1 };

  readonly tx: Tx;

  constructor() {
    const w = this;
    const bySeason = <T extends { season_id: number }>(rows: T[], where?: { season_id?: number }) =>
      rows.filter(r => where?.season_id === undefined || r.season_id === where.season_id);
    // Only the methods the ledger services call are provided.
    const fake = {
      readyStock: { findMany: async (a?: { where?: { season_id?: number } }) => bySeason(w.readyStock, a?.where) },
      modelProduction: { findMany: async (a?: { where?: { season_id?: number } }) => bySeason(w.modelProds, a?.where) },
      returnItem: { findMany: async (a?: { where?: { season_id?: number } }) => bySeason(w.returns, a?.where) },
      sale: { findMany: async (a?: { where?: { season_id?: number } }) => bySeason(w.sales, a?.where) },
      shippingCollection: {
        findMany: async (a: { where: { sale_id: number } }) => w.collections.filter(c => c.sale_id === a.where.sale_id),
        createMany: async (a: { data: Omit<ShippingCollection, 'id' | 'created_at'>[] }) => {
          a.data.forEach(d => w.collections.push({ ...d, id: w.ids.col++, created_at: new Date() }));
          return { count: a.data.length };
        },
      },
      orderCancellation: {
        create: async (a: { data: Omit<OrderCancellation, 'id' | 'created_at' | 'reopened_at'> }) => {
          const row: OrderCancellation = { ...a.data, id: w.ids.canc++, created_at: new Date(), reopened_at: null };
          w.cancellations.push(row);
          return row;
        },
        findFirst: async (a: { where: { sale_id: number; reopened_at: null } }) =>
          [...w.cancellations].reverse().find(c => c.sale_id === a.where.sale_id && c.reopened_at === null) ?? null,
        update: async (a: { where: { id: number }; data: Partial<OrderCancellation> }) => {
          const row = w.cancellations.find(c => c.id === a.where.id)!;
          Object.assign(row, a.data);
          return row;
        },
      },
      inventoryMovement: {
        findMany: async (a: { where: { sale_id: number } }) => w.movements.filter(m => m.sale_id === a.where.sale_id),
        createMany: async (a: { data: Omit<InventoryMovement, 'id' | 'created_at'>[] }) => {
          a.data.forEach(d => w.movements.push({ ...d, id: w.ids.mov++, created_at: new Date() }));
          return { count: a.data.length };
        },
      },
    };
    this.tx = fake as unknown as Tx;
  }

  /** Records finished goods coming in (production or purchase) — like a model-production entry. */
  addProduction(code: string, color: string, qty: number, season = 1): void {
    this.modelProds.push({
      id: this.modelProds.length + 1, season_id: season, date: '2026-10-10', cut_number: 1, model_code: code, qty_from_cutting: qty,
      model_description: code, color, sizes: '', status: 'تام', wastage: 0, qty_received: qty, cost_per_piece: 0,
      warehouse_entry_date: '', created_at: new Date(),
    });
  }
  /** Re-derive and store reserved_quantity, as resyncReservations() does after production / returns. */
  async resync(season = 1): Promise<void> {
    const ctx = await loadStockContext(this.tx, season);
    reservedSyncUpdates(ctx, new Set(ctx.positions.map(p => p.key))).forEach(u => {
      const r = this.readyStock.find(x => x.id === u.id);
      if (r) r.reserved_quantity = u.to;
    });
  }
  /** The consolidated «ملخص النواقص» for a season, built exactly as the Dashboard builds it. */
  missingSummary(season = 1) {
    const sales = this.sales.filter(s => s.season_id === season);
    const modelProds = this.modelProds.filter(r => r.season_id === season);
    const ctx = computeStockPositions({
      readyStock: this.readyStock.filter(r => r.season_id === season), modelProds, sales, returns_: this.returns.filter(r => r.season_id === season),
    });
    return summarizeMissingStock({ ctx, sales, modelProds });
  }
  allocation(saleId: number, season = 1) {
    const ctx = computeStockPositions({
      readyStock: this.readyStock.filter(r => r.season_id === season), modelProds: this.modelProds.filter(r => r.season_id === season),
      sales: this.sales.filter(s => s.season_id === season), returns_: this.returns.filter(r => r.season_id === season),
    });
    return ctx.allocations.get(saleId);
  }
  addStock(code: string, color: string, opening: number, cost: number, season = 1): ReadyStock {
    const row: ReadyStock = {
      id: this.readyStock.length + 1, season_id: season, model_code: code, product_name: code, color,
      opening_balance: opening, cost_per_piece: cost, location: '', reserved_quantity: 0,
    };
    this.readyStock.push(row);
    return row;
  }

  /** Mirrors the write path of POST/PUT /api/sales for the parts under test. */
  async saveOrder(input: {
    id?: number; season?: number; order_number?: string; status: string; slots: Slot[];
    invoice: number; deposit?: number; collected?: number; date?: string; user?: string;
    /** Model data that predates the shipping check (e.g. goods shipped before it existed). */
    legacy?: boolean;
    /** Required when a SHIPPED order is cancelled: what happened to the goods. */
    disposition?: CancelDisposition;
    reason?: string;
    /** Pieces of each line that came back resalable (default: all, when the disposition is returned_resalable). */
    returnedQty?: number[];
  }): Promise<Sale> {
    // Same rule as POST /sales and PUT /sales/:id: an order that has NOT shipped yet (new, «يتم التجهيز» or cancelled) saved with a
    // shipped status while the pieces are not available is kept as «يتم التجهيز» with its full quantity (nothing deducted); it is
    // refused only if shipping-company money was already entered. An order that already shipped keeps the strict rule.
    let heldFor: string | null = null;
    let awaiting = false;                // «لم يتم الصرف» kept while the pieces are missing (nothing ships)   // status the user asked for while the order is held for missing pieces
    const pre = input.id ? this.sales.find(s => s.id === input.id) : undefined;
    // sales-only extra: pieces added while the order stays «لم يتم الصرف» are in the order (sales) but not in stock
    const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
    const keepsNP = !!pre && ['لم يتم الصرف', 'تم الصرف'].includes(pre.order_status) && ['لم يتم الصرف', 'تم الصرف'].includes(input.status);
    const extras = [1, 2, 3, 4, 5].map(i => {
      const o = pre as unknown as Record<string, unknown> | undefined;
      const ns = input.slots[i - 1];
      if (!keepsNP || !o || !ns || !o[`model${i}_code`] || norm(o[`model${i}_code`]) !== norm(ns.code) || norm(o[`model${i}_color`]) !== norm(ns.color)) return 0;
      return Math.max(0, (Number(o[`model${i}_extra_qty`]) || 0) + (ns.qty - (Number(o[`model${i}_qty`]) || 0)));
    });
    const stockSlots = input.slots.map((sl, i) => ({ ...sl, qty: sl.qty - extras[i] })).filter(sl => sl.qty > 0);
    const preEff = pre ? effectiveStatus(pre) : undefined;
    const unpaidShipped = !!preEff && ['لم يتم الصرف', 'حساب عميل'].includes(preEff.order_status) && preEff.shipping_collected === 0;
    if (!input.legacy && isStockDeducting(input.status) && (!input.id || (preEff && (!isStockDeducting(preEff.order_status) || (unpaidShipped && input.status === 'لم يتم الصرف'))))) {
      const ctx0 = await loadStockContext(this.tx, input.season ?? 1, input.id);
      const problem = validateShipment(ctx0, stockSlots, pre ? increasingKeys(ctx0, outsideSlots(pre), stockSlots) : undefined);
      if (problem) {
        if (input.status === 'لم يتم الصرف') awaiting = true; else heldFor = input.status;
        input = { ...input, status: 'تم الحجز', collected: 0 };
      }   // the pre-filled received amount is not recorded: nothing shipped
    }
    const season = input.season ?? 1;
    const existing = input.id ? this.sales.find(s => s.id === input.id) : undefined;
    const wasCancelled = existing?.order_status === STATUS_CANCELED;
    const willBeCancelled = input.status === STATUS_CANCELED;
    const cancelEvent = !!existing && willBeCancelled && !wasCancelled;
    const cancellingShipped = !!existing && willBeCancelled && isStockDeducting(effectiveStatus(existing).order_status);
    // Cancelling reverses the whole order: the deposit and every collection are taken back with append-only rows
    // (the amounts stay on the cancellation record); a later save of the cancelled order changes nothing.
    // An order cancelled by an earlier version may still hold goods outside / money: saving it finishes the reversal once.
    const goodsOutsideBefore = !!existing && wasCancelled && willBeCancelled && holdsGoodsOutside(existing);
    const refundedBefore = existing && wasCancelled ? this.returns.filter(r => r.order_number === existing.order_number).reduce((n, r) => n + r.refund_amount, 0) : 0;
    const keptDeposit = Math.min(existing?.deposit_paid ?? 0, refundedBefore);
    const reconcile = !!existing && wasCancelled && willBeCancelled && (goodsOutsideBefore || existing.shipping_collected !== 0 || existing.deposit_paid > keptDeposit + 0.005);
    const deposit = willBeCancelled ? (cancelEvent ? 0 : reconcile ? keptDeposit : (existing?.deposit_paid ?? 0)) : (input.deposit ?? 0);
    const collected = willBeCancelled ? (cancelEvent || reconcile ? 0 : (existing?.shipping_collected ?? 0)) : input.status === 'تم الصرف' ? (input.collected ?? 0) : 0;
    if (input.status === 'تم الصرف' && (collected < 0 || collected > input.invoice - deposit + 0.005)) throw new Error('invalid collected amount');
    if (wasCancelled && !willBeCancelled && (existing?.shipping_collected ?? 0) > 0 && input.status !== 'تم الصرف') throw new Error('المحصّل محتجز');
    const disposition: CancelDisposition | null = !willBeCancelled ? null
      : cancelEvent ? (cancellingShipped ? 'returned_resalable' : null) : goodsOutsideBefore ? 'returned_resalable' : ((existing?.cancel_disposition as CancelDisposition | null) ?? null);

    const row: Sale = existing ?? ({
      id: this.ids.sale++, season_id: season, order_number: input.order_number ?? `SO-${this.ids.sale}`, row_number: 0, marketer: '', client: 'c',
      invoice_value: 0, deposit_paid: 0, deposit_receiver: '', remaining: 0, shipping_number: '', order_status: '', delivery_method: '',
      mobile: '', warehouse: '', shipping_collected: 0, shipping_collected_date: null, created_at: new Date('2026-10-01T09:00:00Z'),
      model1_code: '', model1_qty: 0, model1_color: '', model2_code: '', model2_qty: 0, model2_color: '', model3_code: '', model3_qty: 0, model3_color: '',
      model4_code: '', model4_qty: 0, model4_color: '', model5_code: '', model5_qty: 0, model5_color: '', cancel_disposition: null, requested_status: null, awaiting_stock: false,
      model1_extra_qty: 0, model2_extra_qty: 0, model3_extra_qty: 0, model4_extra_qty: 0, model5_extra_qty: 0,
      model1_unreturned_qty: null, model2_unreturned_qty: null, model3_unreturned_qty: null, model4_unreturned_qty: null, model5_unreturned_qty: null,
    });
    // Same rule as the routes: «يتم التجهيز» is always accepted; goods leaving the factory must exist
    // and not be held for other orders (only checked where the shipped quantity goes UP).
    if (!input.legacy && isStockDeducting(input.status)) {
      const ctx = await loadStockContext(this.tx, season, existing?.id);
      const oldShipped = existing ? outsideSlots(existing) : [];
      const problem = validateShipment(ctx, stockSlots, increasingKeys(ctx, oldShipped, stockSlots));
      if (problem) throw new Error(problem);
    }
    const lineQty = [1, 2, 3, 4, 5].map(i => (input.slots[i - 1]?.code ? input.slots[i - 1].qty : 0));
    const unreturned: number[] | null = (cancelEvent && cancellingShipped) || goodsOutsideBefore ? [0, 0, 0, 0, 0] : null;
    const restoredQty = goodsOutsideBefore && existing ? outsideSlots(existing).reduce((n, o) => n + o.qty, 0) : unreturned ? lineQty.reduce((x, y) => x + y, 0) : 0;
    const reversedAmounts = { id: row.id, deposit_paid: row.deposit_paid, shipping_collected: row.shipping_collected };   // as they were BEFORE the reversal
    const previousCached = row.shipping_collected;
    const storedDate = row.shipping_collected_date;
    const oldDisposition = existing?.cancel_disposition ?? null;   // captured before the row is mutated

    Object.assign(row, {
      order_status: awaiting ? 'لم يتم الصرف' : input.status, awaiting_stock: awaiting, invoice_value: input.invoice, deposit_paid: deposit, remaining: input.invoice - deposit,
      shipping_collected: collected, cancel_disposition: disposition, requested_status: heldFor,
    });
    for (let i = 1; i <= 5; i++) {
      const s = input.slots[i - 1];
      Object.assign(row, { [`model${i}_code`]: s?.code ?? '', [`model${i}_qty`]: s?.qty ?? 0, [`model${i}_color`]: s?.color ?? '', [`model${i}_extra_qty`]: extras[i - 1] });
    }
    if (!willBeCancelled) for (let i = 1; i <= 5; i++) Object.assign(row, { [`model${i}_unreturned_qty`]: null });
    else if (unreturned) unreturned.forEach((u, i) => Object.assign(row, { [`model${i + 1}_unreturned_qty`]: u }));
    if (!existing) this.sales.push(row);

    const date = collectionDate(input.date, storedDate);
    await syncCollections(this.tx, row, { previousCached, desired: collected, date, user: input.user });
    if (collected > 0 && !row.shipping_collected_date) row.shipping_collected_date = date;
    // route rule (resolvePayoutDate): an order that newly reaches «تم الصرف» takes the explicit payout date it was given
    if (input.status === 'تم الصرف' && storedDate === null && input.date) row.shipping_collected_date = input.date;
    else if (input.status === 'تم الصرف' && wasCancelled && input.date) row.shipping_collected_date = input.date;
    if (input.status !== 'تم الصرف' && !willBeCancelled) row.shipping_collected_date = null;
    const shippedBefore = cancellingShipped ? await shippedSnapshot(this.tx, row.id) : { qty: 0, cost: 0 };
    await syncShipMovements(this.tx, row, input.user);
    if (willBeCancelled && !wasCancelled) {
      await recordCancellation(this.tx, {
        seasonId: season, sale: reversedAmounts, statusBefore: existing?.order_status ?? '', wasShipped: cancellingShipped, disposition,
        reason: input.reason ?? '', snapshot: shippedBefore, user: input.user, restoredQty,
      });
    } else if (willBeCancelled && wasCancelled && (disposition !== oldDisposition || reconcile)) {
      await updateDisposition(this.tx, row.id, disposition, hasLineReturns(row) ? restoredQty : undefined);
    } else if (!willBeCancelled && wasCancelled) {
      await markReopened(this.tx, row.id);
    }

    // stored reserved_quantity, recomputed from the reservation orders (as syncReserved does)
    const ctx = await loadStockContext(this.tx, season);
    reservedSyncUpdates(ctx, new Set(ctx.positions.map(p => p.key))).forEach(u => {
      const r = this.readyStock.find(x => x.id === u.id);
      if (r) r.reserved_quantity = u.to;
    });
    return row;
  }

  /** Mirrors POST /sales/:id/refunds → customer_refund (a refund row on the Returns ledger). */
  recordCustomerRefund(saleId: number, amount: number): void {
    const sale = this.sales.find(s => s.id === saleId)!;
    this.returns.push({
      id: this.ids.ret++, season_id: sale.season_id, date: '2026-10-20', order_number: sale.order_number, client_name: sale.client,
      returned_by: '', paid_by: '', model_code: '', model_qty: 0, model_color: '', refund_amount: amount, notes: 'رد عربون أوردر ملغى', created_at: new Date(),
    });
  }
  /** Mirrors POST /sales/:id/refunds → shipping_repayment (negative row on the collection ledger). */
  recordShippingRepayment(saleId: number, amount: number): void {
    const sale = this.sales.find(s => s.id === saleId)!;
    this.collections.push({
      id: this.ids.col++, season_id: sale.season_id, sale_id: saleId, amount: -amount, kind: 'repayment', collected_date: '2026-10-20',
      date_estimated: false, reference: 'repayment:test', created_by: '', created_at: new Date(),
    });
    sale.shipping_collected = ledgerTotal(this.collections.filter(c => c.sale_id === saleId));
  }
  obligations(saleId: number) {
    const sale = this.sales.find(s => s.id === saleId)!;
    return cancelledObligations(sale, refundsFor(refundsByOrderNumber(this.returns.filter(r => r.season_id === sale.season_id)), sale.order_number));
  }

  // ── financial read-models: the same functions the Dashboard uses ──
  cash(season = 1) {
    const cf = computeDashboardCashFlow({
      sales: this.sales.filter(s => s.season_id === season), expenses: [],
      returns_: this.returns.filter(r => r.season_id === season), paymentLogs: [],
    });
    return { ...cf, cash: cf.totalIn - cf.totalOut };
  }
  shippingReceivable(season = 1) {
    return computeMoneyOwedToUs({ sales: effectiveSales(this.sales.filter(s => s.season_id === season)), clientAccts: [] });
  }
  stock(season = 1) {
    const ctx = computeStockPositions({
      readyStock: this.readyStock.filter(r => r.season_id === season), modelProds: this.modelProds.filter(r => r.season_id === season),
      sales: this.sales.filter(s => s.season_id === season), returns_: this.returns.filter(r => r.season_id === season),
    });
    let physical = 0, reserved = 0, available = 0, physicalQty = 0, availableQty = 0, reservedQty = 0, pendingQty = 0;
    ctx.positions.forEach(p => {
      const v = valueStockRow(p.actual, p.reserved, p.row.cost_per_piece);
      physical += v.physicalValue; reserved += v.reservedValue; available += v.availableValue;
      physicalQty += v.physicalQty; reservedQty += v.reservedQty; availableQty += v.availableQty; pendingQty += p.pending;
    });
    return { physical, reserved, available, physicalQty, reservedQty, availableQty, pendingQty };
  }
  cogs(season = 1) {
    const saleIds = new Set(this.sales.filter(s => s.season_id === season).map(s => s.id));
    const rows: MovementRow[] = this.movements.filter(m => saleIds.has(m.sale_id));
    const idx = new FuzzyKeyIndex(['model', 'color']);
    const keyOf = (c: string, col: string) => idx.resolve([c, col || '']);
    const byOrder = new Map<string, MovementRow[]>();
    this.movements.forEach(m => {
      const sale = this.sales.find(s => s.id === m.sale_id);
      if (!sale || sale.season_id !== season) return;
      byOrder.set(sale.order_number, [...(byOrder.get(sale.order_number) ?? []), m]);
    });
    const credit = returnsCostCredit({
      returns: this.returns.filter(r => r.season_id === season).map(r => ({ order_number: r.order_number, model_code: r.model_code, model_color: r.model_color, model_qty: r.model_qty })),
      movementsByOrder: byOrder, keyOf,
    }).credit;
    return costOfGoodsShipped(rows) - credit;
  }
  ledgerFor(saleId: number) {
    const rows = this.collections.filter(c => c.sale_id === saleId);
    return { rows, total: ledgerTotal(rows) };
  }
}

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { getSeasonId, seasonWhere } from '../services/seasonContext';
import { cairoToday, isValidDate } from '../services/charity';
import {
  STATUS_CANCELED, STATUS_RESERVED, computeStockPositions, hasLineReturns, increasingKeys, isCancelDisposition, isStockDeducting,
  effectiveStatus, holdsGoodsOutside, isAwaitingStock, outsideSlots, reservedSyncUpdates, validateShipment, type CancelDisposition,
} from '../services/readyStockPositions';
import {
  REFUND_KINDS, applyRefund, buildCancellationPreview, cancelledObligations, computeUnreturned, isRefundError, markReopened,
  recordCancellation, refundsByOrderNumber, refundsFor, reverseClientInvoices, shippedSnapshot, updateDisposition,
  type RefundKind,
} from '../services/orderCancellation';
import { lockStock } from '../services/reservationSync';
import { ledgerTotal } from '../services/shippingCollections';
import { collectionDate, loadStockContext, syncCollections, syncShipMovements } from '../services/orderLedgers';
import { outstandingShippingReceivable } from '../services/receivablesAudit';

const router = Router();
router.use(authenticate);

// ─── helpers ────────────────────────────────────────────────────────────────

type ModelSlot = { code: string; qty: number; color: string };

function extractModels(data: Record<string, unknown>): ModelSlot[] {
  return [1, 2, 3, 4, 5]
    .map(i => ({
      code: (data[`model${i}_code`] as string) || '',
      qty: (Number(data[`model${i}_qty`]) || 0) - (Number(data[`model${i}_extra_qty`]) || 0),   // stock quantity: the sales-only extra is excluded
      color: (data[`model${i}_color`] as string) || '',
    }))
    .filter(m => m.code && m.qty > 0);
}

type Tx = Prisma.TransactionClient;

// Raised inside a transaction to roll everything back and answer 400 with an Arabic message.
class StockError extends Error {}

// Brings ready_stock.reserved_quantity in line with the reservation ORDERS for the stock rows
// the given slots map to. Recomputing (instead of +/- deltas) means a reservation is applied or
// released exactly once however many times it is edited, cancelled or retried.
async function syncReserved(tx: Tx, seasonId: number, slots: ModelSlot[]) {
  const ctx = await loadStockContext(tx, seasonId);
  const keys = new Set(slots.map(m => ctx.keyOf(m.code, m.color)));
  const updates = reservedSyncUpdates(ctx, keys);
  for (const u of updates) {
    await tx.readyStock.update({ where: { id: u.id }, data: { reserved_quantity: u.to } });
  }
}

const slotSignature = (slots: ModelSlot[]) =>
  slots.map(m => `${m.code}|${m.color}|${m.qty}`).sort().join(';');

const describeSlots = (slots: ModelSlot[]) =>
  slots.map(m => `${m.code}${m.color ? `/${m.color}` : ''}×${m.qty}`).join('، ');

// Inventory movement trail (the system has no movement table; the audit log is its ledger).
function logStockMovement(
  user: Request['user'], action: 'STOCK_RESERVED' | 'STOCK_RELEASED' | 'STOCK_SHIPPED',
  sale: { id: number; client: string; order_number: string }, slots: ModelSlot[], note: string,
) {
  if (slots.length === 0) return;
  logAudit({
    user, module: 'ReadyStock', action, record_id: sale.id,
    after_data: { order_number: sale.order_number, slots },
    description: `${note}: ${sale.client} - ${sale.order_number} — ${describeSlots(slots)}`,
  });
}

// Validate a shipping-payout "received amount" against the real remaining balance.
function parseReceivedAmount(raw: unknown, remaining: number): { value: number } | { error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { error: 'المبلغ المستلم من شركة الشحن مطلوب' };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { error: 'المبلغ المستلم غير صالح' };
  }
  if (value < 0) {
    return { error: 'المبلغ المستلم لا يمكن أن يكون أقل من صفر' };
  }
  // Guard against floating point noise (e.g. remaining=5000, received=5000.0000000001)
  if (value > remaining + 0.005) {
    return { error: 'المبلغ المستلم لا يمكن أن يكون أكبر من المبلغ المتبقي' };
  }
  return { value: Math.min(value, remaining) };
}

// Resolves what "shipping_collected" must be saved as for a given (about-to-be-saved)
// order_status, folding in the "تم الصرف" business rule everywhere a sale is written:
//   - status !== 'تم الصرف'  → always 0. The order isn't dispatched (or was un-dispatched),
//     so no shipping-company receipt can be an active cash transaction (point: "do not
//     leave the previous received amount as an active cash transaction").
//   - status === 'تم الصرف' → the caller-supplied amount, validated against the real
//     remaining balance server-side (never trusted blindly). If the caller didn't resend
//     it (e.g. an edit that only touches other fields on an already-dispatched order),
//     the previously saved amount carries over — re-validated against the current
//     remaining balance so it can never end up saved above it.
function resolveShippingCollected(
  status: string,
  providedRaw: unknown,
  remaining: number,
  wasDispatched: boolean,
  previouslyReceived: number,
): { value: number; isCorrection: boolean } | { error: string } {
  // Cancelling is NOT a refund: whatever the shipping company already paid stays recorded (and stays cash)
  // until a real repayment is entered via POST /sales/:id/refunds.
  if (status === STATUS_CANCELED) return { value: previouslyReceived, isCorrection: false };
  if (status !== 'تم الصرف') {
    return { value: 0, isCorrection: false };
  }
  const candidate = providedRaw !== undefined ? providedRaw : (wasDispatched ? previouslyReceived : undefined);
  const parsed = parseReceivedAmount(candidate, Math.max(remaining, 0));
  if ('error' in parsed) return parsed;
  return { value: parsed.value, isCorrection: wasDispatched };
}

// Day the shipping company's payout belongs to (drives the monthly-charity month).
//   - not 'تم الصرف'            → null (no active receipt)
//   - caller sent a valid date   → that date (lets a payout be dated to when it was really received)
//   - already dispatched         → keep the stored date (a pure amount correction must not move
//                                  the money to another month); legacy NULL stays NULL
//   - newly dispatched           → today (Cairo)
function resolvePayoutDate(status: string, providedRaw: unknown, wasDispatched: boolean, previous: string | null): { value: string | null } | { error: string } {
  if (status === STATUS_CANCELED) return { value: previous ?? null };   // keep the receipt date of money still held
  if (status !== 'تم الصرف') return { value: null };
  if (providedRaw !== undefined && providedRaw !== null && providedRaw !== '') {
    if (!isValidDate(providedRaw)) return { error: 'تاريخ استلام المبلغ من شركة الشحن غير صالح' };
    return { value: providedRaw };
  }
  if (wasDispatched) return { value: previous ?? null };
  return { value: cairoToday() };
}

// An order that is owed by the shipping company must not ALSO be a client-account invoice
// (both feed "money owed to us"). Checked when an order starts carrying a receivable.
async function clientInvoiceOverlap(seasonId: number, orderNumber: string): Promise<string | null> {
  const inv = await prisma.clientAccountInvoice.findFirst({
    where: { season_id: seasonId, order_number: { equals: orderNumber.trim(), mode: 'insensitive' } },
  });
  return inv
    ? `الأوردر ${orderNumber} مسجّل بالفعل كفاتورة في حساب عميل — جعله مستحقًا على شركة الشحن يعدّ نفس المبلغ مرتين. استخدم حالة «حساب عميل» أو احذف الفاتورة من الحساب أولًا.`
    : null;
}

// ─── routes ─────────────────────────────────────────────────────────────────

// How much of a «يتم التجهيز» order is really held in stock vs still to be produced / purchased.
async function fulfillmentOf(seasonId: number, saleId?: number) {
  const [sales, readyStock, modelProds, returns_] = await Promise.all([
    prisma.sale.findMany({ where: seasonWhere(seasonId), orderBy: { id: 'asc' } }),
    prisma.readyStock.findMany({ where: seasonWhere(seasonId) }),
    prisma.modelProduction.findMany({ where: seasonWhere(seasonId) }),
    prisma.returnItem.findMany({ where: seasonWhere(seasonId) }),
  ]);
  const { allocations } = computeStockPositions({ readyStock, modelProds, sales, returns_ });
  const shape = (a: { requested: number; reserved: number; pending: number; slots: unknown }) => ({ requested: a.requested, reserved: a.reserved, pending: a.pending, slots: a.slots });
  return { sales, allocations, one: saleId !== undefined && allocations.get(saleId) ? shape(allocations.get(saleId)!) : null, shape };
}

// GET /api/sales
router.get('/', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const { sales, allocations, shape } = await fulfillmentOf(seasonId);
    return res.json(sales.map(s => {
      const a = allocations.get(s.id);
      return a ? { ...s, fulfillment: shape(a) } : s;
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المبيعات' });
  }
});

// POST /api/sales
router.post('/', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const data = req.body as Record<string, unknown>;
    delete data.cancel_reason;          // lives on the cancellation record, not on the order
    data.cancel_disposition = null;     // set only when a shipped order is cancelled
    delete data.requested_status;       // server-managed: set below only when a shipped status had to be held
    delete data.awaiting_stock;         // server-managed too
    for (let i = 1; i <= 5; i++) delete data[`model${i}_extra_qty`];   // server-managed: only a quantity edit of a «لم يتم الصرف» order creates it
    const status = (data.order_status as string) || '';
    const remaining = (Number(data.invoice_value) || 0) - (Number(data.deposit_paid) || 0);

    // A brand-new order can be entered directly as "تم الصرف" (e.g. a counter sale) —
    // the same received-amount rule applies: only the amount actually confirmed as
    // received from the shipping company is ever recorded, never the full remaining
    // balance, and it's re-validated here regardless of what the frontend sent.
    const resolved = resolveShippingCollected(status, data.shipping_collected, remaining, false, 0);
    if ('error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }

    const payoutDate = resolvePayoutDate(status, data.shipping_collected_date, false, null);
    if ('error' in payoutDate) return res.status(400).json({ message: payoutDate.error });

    if (outstandingShippingReceivable({ order_status: status, remaining, shipping_collected: resolved.value }) > 0) {
      const overlap = await clientInvoiceOverlap(seasonId, String(data.order_number ?? ''));
      if (overlap) return res.status(400).json({ message: overlap });
    }

    const { season: _season, id: _id, season_id: _seasonId, ...saleData } = data as Omit<Prisma.SaleUncheckedCreateInput, 'season_id' | 'remaining'> & Record<string, unknown>;

    const newSlots = extractModels(data);
    const explicitDate = data.shipping_collected_date;
    let downgradeReason = '';
    let awaitingReason = '';
    let ignoredCollected = 0;
    const sale = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      // «يتم التجهيز» is always accepted — whatever is not in stock is simply left pending.
      // Goods that physically leave the factory must exist and not be held for other orders. A NEW order entered directly as
      // shipped while the stock is short is not rejected: it is saved as «يتم التجهيز» with its FULL quantity (what exists is
      // reserved, the rest is a tracked shortage) and nothing is deducted. If money from the shipping company was already
      // entered, that cannot be dropped silently, so the order is refused with an explanation instead.
      // «لم يتم الصرف» keeps its status while the pieces are missing (awaiting_stock: nothing ships, a reservation + shortage is tracked);
      // the other shipped statuses are held as «يتم التجهيز» with the request remembered.
      let logicStatus = status;
      let awaitingStock = false;
      if (isStockDeducting(status)) {
        const problem = validateShipment(await loadStockContext(tx, seasonId), newSlots);
        if (problem) {
          logicStatus = STATUS_RESERVED;
          ignoredCollected = status === 'تم الصرف' ? resolved.value : 0;   // nothing shipped, so nothing received: not recorded
          if (status === 'لم يتم الصرف') { awaitingStock = true; awaitingReason = problem; }
          else downgradeReason = problem;
        }
      }
      const reserve = logicStatus === STATUS_RESERVED;
      const created = await tx.sale.create({
        data: {
          ...saleData,
          order_status: awaitingStock ? status : logicStatus,
          awaiting_stock: awaitingStock,
          requested_status: downgradeReason ? status : null,
          season_id: seasonId,
          remaining,
          shipping_collected: reserve ? 0 : resolved.value,
          shipping_collected_date: reserve ? null : payoutDate.value,
        },
      });
      if (reserve) await syncReserved(tx, seasonId, newSlots);
      await syncCollections(tx, created, { previousCached: 0, desired: reserve ? 0 : resolved.value, date: collectionDate(explicitDate, null), user: req.user?.username });
      await syncShipMovements(tx, created, req.user?.username);
      return created;
    });

    const savedAsReservation = sale.order_status === STATUS_RESERVED || isAwaitingStock(sale);
    if (savedAsReservation) logStockMovement(req.user, 'STOCK_RESERVED', sale, newSlots, downgradeReason ? 'حجز مخزون (الكمية غير متوفرة للشحن)' : 'حجز مخزون');
    else if (isStockDeducting(status)) logStockMovement(req.user, 'STOCK_SHIPPED', sale, newSlots, 'خروج مخزون (شحن)');

    const isDispatched = sale.order_status === 'تم الصرف' && !isAwaitingStock(sale);
    const collection_difference = isDispatched ? Math.max(0, remaining - resolved.value) : 0;
    logAudit({
      user: req.user, module: 'Sales', action: isDispatched ? 'SHIPPING_PAYOUT_CONFIRMED' : 'CREATE', record_id: sale.id,
      after_data: isDispatched ? { ...sale, collection_difference } : sale,
      description: downgradeReason ? `إضافة عملية بيع: ${sale.client} - ${sale.order_number} — حُفظ «يتم التجهيز» بدل «${status}» لأن الكمية غير متوفرة (${downgradeReason})` : isDispatched
        ? `إضافة عملية بيع (تم الصرف مباشرة): ${sale.client} - ${sale.order_number} — المتبقي: ${remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}`
        : `إضافة عملية بيع: ${sale.client} - ${sale.order_number}`,
    });
    return res.status(201).json({ ...sale, collection_difference, fulfillment: (await fulfillmentOf(seasonId, sale.id)).one, status_downgraded: !!downgradeReason, requested_status: status, downgrade_reason: downgradeReason || null, ignored_collected: ignoredCollected, awaiting_stock: !!awaitingReason, awaiting_reason: awaitingReason || null });
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إضافة الطلب' });
  }
});

const DISPOSITION_LABELS: Record<CancelDisposition, string> = {
  returned_resalable: 'رجعت وصالحة للبيع',
  not_returned: 'لم ترجع (عند العميل / شركة الشحن)',
  returned_damaged: 'رجعت تالفة / تحتاج فحصًا',
};

// PUT /api/sales/:id
router.put('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const data = req.body as Record<string, unknown>;

    const oldRaw = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!oldRaw) return res.status(404).json({ message: 'الطلب غير موجود' });
    // An order held for missing pieces («لم يتم الصرف» + awaiting_stock) has not shipped: every stock / money rule sees it as «يتم التجهيز».
    const oldSale = effectiveStatus(oldRaw);

    const wasReservation = oldSale.order_status === 'تم الحجز';
    let newStatus = (data.order_status as string | undefined) ?? oldRaw.order_status;

    // ── Quantity edits on an order that stays «لم يتم الصرف» / «تم الصرف» are SALES-ONLY ──
    // The order quantity and value follow the edit, but the extra pieces are never reserved, deducted, costed or counted as a shortage:
    // stock keeps seeing only the quantity it already accounted for (model{i}_qty − model{i}_extra_qty). Lowering the quantity removes
    // extra pieces first. The extra is kept when the order moves between these two statuses (confirming a payout is not a shipment);
    // any other status change (e.g. back to «يتم التجهيز» and shipped again) resets it to 0, so the whole quantity is validated and shipped.
    const SHIPPED_STATUSES = ['لم يتم الصرف', 'تم الصرف'];
    const keepsNotPaidOut = SHIPPED_STATUSES.includes(oldRaw.order_status) && SHIPPED_STATUSES.includes(newStatus);
    const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
    for (let i = 1; i <= 5; i++) {
      const rec = oldRaw as unknown as Record<string, unknown>;
      const oldQty = Number(rec[`model${i}_qty`]) || 0;
      const oldExtra = Number(rec[`model${i}_extra_qty`]) || 0;
      const newQty = data[`model${i}_qty`] !== undefined ? Number(data[`model${i}_qty`]) || 0 : oldQty;
      const sameItem = !!rec[`model${i}_code`]
        && norm(data[`model${i}_code`] ?? rec[`model${i}_code`]) === norm(rec[`model${i}_code`])
        && norm(data[`model${i}_color`] ?? rec[`model${i}_color`]) === norm(rec[`model${i}_color`]);
      data[`model${i}_extra_qty`] = keepsNotPaidOut && sameItem ? Math.max(0, oldExtra + (newQty - oldQty)) : 0;
    }

    // Saving an edit is not a shipment. When an order that has NOT shipped yet (يتم التجهيز / cancelled) is saved with a shipped
    // status while its pieces are not available, the edit is kept (requested quantities untouched), the order stays «يتم التجهيز»
    // and the missing pieces are tracked as a shortage — nothing is deducted and no pieces held for other orders are used.
    // An order already marked «لم يتم الصرف» / «حساب عميل» (shipped, nothing collected yet) whose edit needs MORE pieces than exist
    // cannot be shipped for the extra pieces either (partial shipment is unsupported): it goes back to «يتم التجهيز», its shipment
    // is reversed through the ledgers (stock and cost at the recorded cost, revenue, receivable) and the edit is kept. A paid-out
    // order that already collected money is never un-shipped this way and keeps the strict rule below.
    let downgradeReason = '';
    let requestedStatus = '';
    let ignoredCollected = 0;
    let shipmentReversed = false;
    let holdAwaiting = false;
    let awaitingReason = '';
    const unpaidShipped = ['لم يتم الصرف', 'حساب عميل'].includes(oldSale.order_status) && oldSale.shipping_collected === 0;
    if (isStockDeducting(newStatus) && (!isStockDeducting(oldSale.order_status) || (unpaidShipped && newStatus === 'لم يتم الصرف'))) {
      const wanted = extractModels({ ...oldSale, ...data } as unknown as Record<string, unknown>);
      const pre = await loadStockContext(prisma as unknown as Prisma.TransactionClient, seasonId, id);
      const problem = validateShipment(pre, wanted, increasingKeys(pre, outsideSlots(oldSale), wanted));
      if (problem && newStatus === 'لم يتم الصرف') {
        // Keep «لم يتم الصرف»: the order is saved with its full quantity but has NOT shipped (awaiting_stock) — a reservation + shortage
        // is tracked, nothing is deducted, no cost/revenue/receivable. A shipment it already had is reversed through the ledgers.
        holdAwaiting = true;
        awaitingReason = problem;
        shipmentReversed = isStockDeducting(oldSale.order_status);
        newStatus = STATUS_RESERVED;           // rules below see an unshipped order; data.order_status keeps the user's choice
      } else if (problem) {
        // The Edit Order form pre-fills the received amount with the remaining balance as soon as «تم الصرف» is selected («صرف الحجز»
        // does the same), so an amount arrives with almost every such save. The order is NOT shipped, so nothing is received yet:
        // it is not recorded, and the amount is returned so the screen can say so.
        ignoredCollected = newStatus === 'تم الصرف' ? Math.max(0, Number(data.shipping_collected) || 0) : 0;
        shipmentReversed = isStockDeducting(oldSale.order_status);
        requestedStatus = newStatus;
        newStatus = STATUS_RESERVED;
        data.order_status = STATUS_RESERVED;
        downgradeReason = problem;
      }
    }
    const willBeReservation = newStatus === 'تم الحجز';

    // ── Cancellation ──
    const wasCancelled = oldSale.order_status === STATUS_CANCELED;
    const willBeCancelled = newStatus === STATUS_CANCELED;
    const cancellingShipped = willBeCancelled && isStockDeducting(oldSale.order_status);
    const cancelReason = typeof data.cancel_reason === 'string' ? data.cancel_reason.trim().slice(0, 300) : '';
    delete data.cancel_reason;            // not a column of sales: it is stored on the cancellation record
    // Cancelling reverses the WHOLE order automatically: no returned-goods condition, no returned quantities, no refund inputs.
    // Anything the browser still sends for those is ignored.
    ['cancel_disposition', 'cancel_returned_qty', 'refund_customer_now', 'repay_shipping_now', 'refund_key', 'refund_date'].forEach(k => delete data[k]);
    const unretKeys = [1, 2, 3, 4, 5].map(i => `model${i}_unreturned_qty`);
    const lineQty = [1, 2, 3, 4, 5].map(i => (oldSale[`model${i}_code` as keyof typeof oldSale] ? (Number(oldSale[`model${i}_qty` as keyof typeof oldSale]) || 0) - (Number(oldSale[`model${i}_extra_qty` as keyof typeof oldSale]) || 0) : 0));
    const cancelEvent0 = willBeCancelled && !wasCancelled;
    // An order cancelled by an EARLIER version may still hold goods outside the stock (marked not returned / damaged)
    // or money it never reversed. Saving it again finishes the job — once: afterwards nothing is left to reconcile.
    const refundedBefore = wasCancelled && willBeCancelled
      ? refundsFor(refundsByOrderNumber(await prisma.returnItem.findMany({ where: { ...seasonWhere(seasonId), order_number: oldSale.order_number } })), oldSale.order_number)
      : 0;
    const goodsOutsideBefore = wasCancelled && willBeCancelled && holdsGoodsOutside(oldSale);
    const keptDeposit = Math.min(oldSale.deposit_paid, refundedBefore);   // refunds already paid out stay balanced (cash in = cash out)
    const reconcile = wasCancelled && willBeCancelled && (goodsOutsideBefore || oldSale.shipping_collected !== 0 || oldSale.deposit_paid > keptDeposit + 0.005);
    // Shipped orders come back in full (every line, at the cost recorded when it shipped); reserved ones just release.
    // An already-cancelled order keeps whatever its first cancellation recorded, so repeated saves change nothing.
    const disposition: CancelDisposition | null = !willBeCancelled ? null
      : cancelEvent0 ? (cancellingShipped ? 'returned_resalable' : null)
      : goodsOutsideBefore ? 'returned_resalable'
      : ((oldSale.cancel_disposition as CancelDisposition | null) ?? null);
    data.cancel_disposition = disposition;
    data.requested_status = downgradeReason ? requestedStatus : null;   // remembered only while the order is held for missing pieces
    data.awaiting_stock = holdAwaiting;
    const restoredQty = cancelEvent0 && cancellingShipped ? lineQty.reduce((a, b) => a + b, 0)
      : goodsOutsideBefore ? outsideSlots(oldSale).reduce((n, o) => n + o.qty, 0) : 0;
    if (!willBeCancelled) unretKeys.forEach(k => { data[k] = null; });                  // reopening: back to a normal order
    else if ((cancelEvent0 && cancellingShipped) || goodsOutsideBefore) unretKeys.forEach(k => { data[k] = 0; });   // nothing is left outside
    else unretKeys.forEach(k => { delete data[k]; });
    if (willBeCancelled) {
      // The deposit is reversed with the order on the cancel event (the amount stays in the cancellation record);
      // later saves of the cancelled order can never bring it back.
      if (cancelEvent0) data.deposit_paid = 0; else if (reconcile) data.deposit_paid = keptDeposit; else delete data.deposit_paid;
    }
    if (wasCancelled && !willBeCancelled && oldSale.shipping_collected > 0 && newStatus !== 'تم الصرف') {
      return res.status(400).json({ message: `الأوردر الملغى عليه تحصيل محفوظ ${oldSale.shipping_collected} ج من شركة الشحن — أعد فتحه بحالة «تم الصرف» أو سجّل رد المبلغ لشركة الشحن أولًا` });
    }

    const inv = Number(data.invoice_value ?? oldSale.invoice_value ?? 0);
    const dep = Number(data.deposit_paid ?? oldSale.deposit_paid ?? 0);
    const remaining = inv - dep;
    if (data.invoice_value !== undefined || data.deposit_paid !== undefined) {
      data.remaining = remaining;
    }

    // The "تم الصرف" rule, enforced on every write, not just a dedicated endpoint:
    // only the amount actually confirmed as received from the shipping company is ever
    // saved as shipping_collected (re-validated against the real remaining balance —
    // never trusted blindly), and it is reset to 0 the moment the order is anything
    // other than "تم الصرف" (no stale received amount is left as an active cash
    // transaction once an order is un-dispatched).
    const wasDispatched = oldSale.order_status === 'تم الصرف';
    const willBeDispatched = newStatus === 'تم الصرف';
    const resolved = resolveShippingCollected(newStatus, data.shipping_collected, remaining, wasDispatched, oldSale.shipping_collected);
    if ('error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }
    if (cancelEvent0 || reconcile) resolved.value = 0;   // append-only reversal rows bring the order's collections to zero
    data.shipping_collected = resolved.value;
    const newOrderNumber = String(data.order_number ?? oldSale.order_number);
    const newOutstanding = outstandingShippingReceivable({ order_status: newStatus, remaining, shipping_collected: resolved.value });
    const startsOwing = newOutstanding > 0 && (outstandingShippingReceivable(oldSale) === 0 || newOrderNumber !== oldSale.order_number);
    if (startsOwing) {
      const overlap = await clientInvoiceOverlap(seasonId, newOrderNumber);
      if (overlap) return res.status(400).json({ message: overlap });
    }

    const explicitCollectionDate = data.shipping_collected_date;
    const payoutDate = resolvePayoutDate(newStatus, data.shipping_collected_date, wasDispatched, oldSale.shipping_collected_date);
    if ('error' in payoutDate) return res.status(400).json({ message: payoutDate.error });
    data.shipping_collected_date = payoutDate.value;

    const oldSlots = extractModels(oldSale as unknown as Record<string, unknown>);
    const newSlots = extractModels({ ...oldSale, ...data } as unknown as Record<string, unknown>);
    const slotsChanged = slotSignature(oldSlots) !== slotSignature(newSlots);
    if (wasCancelled && willBeCancelled && oldSale.cancel_disposition && slotsChanged) {
      return res.status(400).json({ message: 'لا يمكن تعديل أصناف أو كميات أوردر ملغى بعد الشحن — أعد فتحه أولًا' });
    }

    let cancelledGoods = { qty: 0, cost: 0 };   // pieces / historical cost that had shipped when the order was cancelled
    const sale = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);

      // Re-read under the lock so a concurrent edit/cancel can't be applied twice.
      const current = await tx.sale.findFirst({ where: { id, season_id: seasonId } });
      if (!current || effectiveStatus(current).order_status !== oldSale.order_status || current.shipping_collected !== oldSale.shipping_collected) {
        throw new StockError('تم تعديل هذا الأوردر من مستخدم آخر — أعد تحميل الصفحة وحاول مرة أخرى');
      }

      // «يتم التجهيز» is always accepted (the shortage is tracked as pending). Shipping is not: when
      // the quantity leaving the factory goes up, it must physically exist and not be held for other
      // orders. Edits that don't increase what was already shipped are never blocked.
      if (isStockDeducting(newStatus)) {
        const ctx = await loadStockContext(tx, seasonId, id);
        // Goods still outside the building after a cancellation (not returned / damaged) count as already shipped.
        const oldShipped = outsideSlots(oldSale);
        const problem = validateShipment(ctx, newSlots, increasingKeys(ctx, oldShipped, newSlots));
        if (problem) throw new StockError(problem);
      }

      // What had shipped, measured BEFORE the reversal rows are appended.
      const shippedBefore = cancellingShipped ? await shippedSnapshot(tx, id) : { qty: 0, cost: 0 };
      const updated = await tx.sale.update({ where: { id }, data: { ...data, season_id: seasonId } });
      await syncReserved(tx, seasonId, [...oldSlots, ...newSlots]);
      // Cash side: append only the change in what the shipping company actually paid.
      await syncCollections(tx, updated, {
        previousCached: current.shipping_collected, desired: resolved.value,
        date: collectionDate(explicitCollectionDate, oldSale.shipping_collected_date), user: req.user?.username,
      });
      // Inventory-cost side: append only the change in what physically left the factory.
      await syncShipMovements(tx, updated, req.user?.username);

      // Cancellation audit row (once per cancel event); disposition changes and reopening update it.
      if (willBeCancelled && !wasCancelled) {
        const invoices = await reverseClientInvoices(tx, { seasonId, orderNumber: updated.order_number, user: req.user?.username });
        await recordCancellation(tx, {
          seasonId, sale: { id, deposit_paid: oldSale.deposit_paid, shipping_collected: oldSale.shipping_collected }, statusBefore: oldSale.order_status, wasShipped: cancellingShipped,
          disposition, reason: cancelReason, snapshot: shippedBefore, user: req.user?.username,
          restoredQty, revenueReversed: isStockDeducting(oldSale.order_status) ? oldSale.invoice_value : 0,
          receivableReversed: outstandingShippingReceivable(oldSale), invoiceIds: invoices.ids,
        });
      } else if (willBeCancelled && wasCancelled && (disposition !== oldSale.cancel_disposition || restoredQty > 0 || reconcile)) {
        await updateDisposition(tx, id, disposition, hasLineReturns(updated) ? restoredQty : undefined);
      } else if (!willBeCancelled && wasCancelled) {
        await markReopened(tx, id);
      }
      cancelledGoods = shippedBefore;
      return tx.sale.findFirstOrThrow({ where: { id, season_id: seasonId } });
    });

    if (willBeReservation && (!wasReservation || slotsChanged)) {
      logStockMovement(req.user, 'STOCK_RESERVED', sale, newSlots, wasReservation ? 'تعديل حجز مخزون' : 'حجز مخزون');
    } else if (wasReservation && !willBeReservation) {
      logStockMovement(req.user, newStatus === STATUS_CANCELED ? 'STOCK_RELEASED' : 'STOCK_SHIPPED', sale, oldSlots,
        newStatus === STATUS_CANCELED ? 'فك حجز مخزون (إلغاء)' : 'خروج مخزون (شحن)');
    }

    const collection_difference = willBeDispatched ? Math.max(0, remaining - resolved.value) : 0;
    const cancelEvent = willBeCancelled && !wasCancelled;
    const reopenEvent = !willBeCancelled && wasCancelled;
    const dispositionEvent = willBeCancelled && wasCancelled && (disposition !== oldSale.cancel_disposition || reconcile);
    const action = cancelEvent ? 'ORDER_CANCELLED'
      : reopenEvent ? 'ORDER_REOPENED'
      : dispositionEvent ? 'CANCEL_DISPOSITION_CHANGED'
      : willBeDispatched
        ? (resolved.isCorrection ? 'SHIPPING_PAYOUT_CORRECTED' : 'SHIPPING_PAYOUT_CONFIRMED')
        : (wasDispatched ? 'SHIPPING_PAYOUT_REVERSED' : 'UPDATE');
    const cancelSummary = {
      goods_qty: cancellingShipped ? cancelledGoods.qty : 0,
      goods_cost: cancellingShipped ? cancelledGoods.cost : 0,
      disposition,
      deposit_held: cancelEvent ? oldSale.deposit_paid : sale.deposit_paid,        // amounts reversed with the order
      collected_held: cancelEvent ? oldSale.shipping_collected : sale.shipping_collected,
    };
    const baseDescription = cancelEvent
      ? `إلغاء أوردر ${sale.client} - ${sale.order_number} (كان: ${oldSale.order_status})${cancellingShipped ? ` — البضاعة: ${DISPOSITION_LABELS[disposition!]} — ${cancelSummary.goods_qty} قطعة بتكلفة مسجلة ${cancelSummary.goods_cost}` : ''} — عُكس العربون ${oldSale.deposit_paid} ج وتحصيل شركة الشحن ${oldSale.shipping_collected} ج بقيود عكسية${cancelReason ? ` — السبب: ${cancelReason}` : ''}`
      : reopenEvent ? `إعادة فتح أوردر ملغى ${sale.client} - ${sale.order_number} إلى «${sale.order_status}»`
      : dispositionEvent ? `تغيير حالة بضاعة أوردر ملغى ${sale.order_number}: ${oldSale.cancel_disposition ? DISPOSITION_LABELS[oldSale.cancel_disposition as CancelDisposition] : '—'} ← ${disposition ? DISPOSITION_LABELS[disposition] : '—'}`
      : willBeDispatched
      ? `تعديل عملية بيع (تم الصرف): ${sale.client} - ${sale.order_number} — المتبقي: ${remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}`
      : (wasDispatched
        ? `تعديل عملية بيع — إلغاء حالة الصرف وعكس المبلغ المستلم سابقًا (${oldSale.shipping_collected}): ${sale.client} - ${sale.order_number}`
        : `تعديل عملية بيع: ${sale.client} - ${sale.order_number}`);

    const description = baseDescription + (downgradeReason ? ` — حُفظ «يتم التجهيز» لأن الكمية غير متوفرة للشحن (${downgradeReason})` : '');
    logAudit({ user: req.user, module: 'Sales', action, record_id: id,
      before_data: oldRaw, after_data: { ...sale, collection_difference, ...(cancelEvent ? { cancellation: { ...cancelSummary, reason: cancelReason } } : {}) }, description });
    if (cancellingShipped && !wasCancelled) {
      logStockMovement(req.user, 'STOCK_RELEASED', sale, oldSlots,
        disposition === 'returned_resalable'
          ? 'إلغاء أوردر مشحون — استرجاع للمخزن بالتكلفة المسجلة وقت الشحن'
          : `إلغاء أوردر مشحون — لا استرجاع للمخزون (${DISPOSITION_LABELS[disposition!]})`);
    }
    return res.json({
      ...sale, collection_difference,
      fulfillment: (await fulfillmentOf(seasonId, id)).one,
      cancellation: willBeCancelled ? cancelSummary : null,
      status_downgraded: !!downgradeReason,
      requested_status: requestedStatus || null,
      awaiting_stock: holdAwaiting,
      awaiting_reason: awaitingReason || null,
      ignored_collected: ignoredCollected,
      shipment_reversed: shipmentReversed,
      downgrade_reason: downgradeReason || null,
    });
  } catch (err) {
    if (err instanceof StockError || isRefundError(err)) return res.status(400).json({ message: (err as Error).message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحديث الطلب' });
  }
});

// GET /api/sales/:id/cancellation-preview — every figure the cancel form shows, computed on the server
router.get('/:id/cancellation-preview', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const preview = await buildCancellationPreview(prisma, seasonId, parseInt(req.params.id as string));
    if (!preview) return res.status(404).json({ message: 'الطلب غير موجود' });
    return res.json(preview);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'خطأ في حساب معاينة الإلغاء' });
  }
});

// GET /api/sales/:id/ledger — collection history + inventory-cost movements of one order
router.get('/:id/ledger', async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    const [collections, movements, cancellations, returns_] = await Promise.all([
      prisma.shippingCollection.findMany({ where: { sale_id: id }, orderBy: { id: 'asc' } }),
      prisma.inventoryMovement.findMany({ where: { sale_id: id }, orderBy: { id: 'asc' } }),
      prisma.orderCancellation.findMany({ where: { sale_id: id }, orderBy: { id: 'asc' } }),
      prisma.returnItem.findMany({ where: { ...seasonWhere(seasonId), order_number: sale.order_number } }),
    ]);
    // What a cancelled order still owes: real cash that has not been given back yet.
    const obligations = sale.order_status === STATUS_CANCELED
      ? cancelledObligations(sale, refundsFor(refundsByOrderNumber(returns_), sale.order_number))
      : null;
    return res.json({ collections, collected_total: ledgerTotal(collections), movements, cancellations, obligations });
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب سجل الأوردر' });
  }
});

// POST /api/sales/:id/refunds — record a REAL refund / repayment for a cancelled order.
//   customer_refund    → returns the customer's deposit            (cash out, recorded as a refund row)
//   shipping_repayment → pays back money the shipping company had paid (cash out, appended to the collection ledger)
// Cancelling alone never moves cash; this is the only place the money actually leaves. Idempotent per key.
router.post('/:id/refunds', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind as RefundKind;
    if (!(REFUND_KINDS as readonly string[]).includes(kind)) return res.status(400).json({ message: 'نوع الرد غير صالح' });
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'مبلغ الرد يجب أن يكون أكبر من صفر' });
    const amt = Math.round(amount * 100) / 100;
    const date = body.date === undefined || body.date === '' ? cairoToday() : body.date;
    if (!isValidDate(date)) return res.status(400).json({ message: 'تاريخ الرد غير صالح' });
    const key = body.idempotency_key;
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) return res.status(400).json({ message: 'معرّف العملية (idempotency_key) مطلوب' });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

    const result = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      return applyRefund(tx, { seasonId, saleId: id, kind, amount: amt, date: date as string, note, key, user: req.user?.username });
    });
    const saleNow = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!saleNow) return res.status(404).json({ message: 'الطلب غير موجود' });

    if (!result.duplicate) {
      logAudit({ user: req.user, module: 'Sales', action: 'ORDER_REFUND_RECORDED', record_id: id,
        after_data: { kind, amount: amt, date, note },
        description: `${kind === 'customer_refund' ? 'رد عربون للعميل' : 'رد مبلغ لشركة الشحن'} ${amt} ج — أوردر ملغى ${saleNow.order_number}${note ? ` — ${note}` : ''}` });
    }
    const returns_ = await prisma.returnItem.findMany({ where: { ...seasonWhere(seasonId), order_number: saleNow.order_number } });
    const fresh = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    return res.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      obligations: fresh ? cancelledObligations(fresh, refundsFor(refundsByOrderNumber(returns_), fresh.order_number)) : null,
    });
  } catch (err) {
    if (err instanceof StockError || isRefundError(err)) return res.status(400).json({ message: (err as Error).message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تسجيل الرد' });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    // Deleting a reservation releases its reserved units, atomically with the delete.
    await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      await tx.sale.delete({ where: { id } });
      if (sale.order_status === STATUS_RESERVED) await syncReserved(tx, seasonId, extractModels(sale as unknown as Record<string, unknown>));
    });
    logAudit({ user: req.user, module: 'Sales', action: 'DELETE', record_id: id,
      before_data: sale, description: `حذف عملية بيع: ${sale?.client} - ${sale?.order_number}` });
    return res.json({ message: 'تم حذف الطلب' });
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    return res.status(500).json({ message: 'خطأ في حذف الطلب' });
  }
});

// POST /api/sales/:id/convert-reservation — تم الحجز → تم الصرف
//
// The frontend now drives this transition through the regular Edit Order modal (status
// dropdown + PUT /api/sales/:id), which shows/validates the received-amount field inline.
// This endpoint is kept for any other caller, but applies the exact same "تم الصرف" rule:
// received_amount is required, validated against the real remaining balance, and only
// that amount — never the full remaining balance — is recorded as collected.
router.post('/:id/convert-reservation', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (sale.order_status !== 'تم الحجز') {
      return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
    }

    const resolved = resolveShippingCollected('تم الصرف', (req.body as Record<string, unknown>)?.received_amount, sale.remaining, false, 0);
    if ('error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }

    const slots = extractModels(sale as unknown as Record<string, unknown>);
    const updated = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      const current = await tx.sale.findFirst({ where: { id, season_id: seasonId } });
      if (!current || current.order_status !== STATUS_RESERVED) throw new StockError('هذا الطلب ليس حجزاً');
      const shipProblem = validateShipment(await loadStockContext(tx, seasonId, id), slots);
      if (shipProblem) throw new StockError(shipProblem);
      // Physical stock drops once status leaves the reservation state; the reservation is released with it.
      const upd = await tx.sale.update({
        where: { id },
        data: { order_status: 'تم الصرف', shipping_collected: resolved.value, shipping_collected_date: cairoToday(), requested_status: null },
      });
      await syncReserved(tx, seasonId, slots);
      await syncCollections(tx, upd, { previousCached: current.shipping_collected, desired: resolved.value, date: cairoToday(), user: req.user?.username });
      await syncShipMovements(tx, upd, req.user?.username);
      return upd;
    });
    logStockMovement(req.user, 'STOCK_SHIPPED', sale, slots, 'خروج مخزون (شحن)');

    const collection_difference = Math.max(0, sale.remaining - resolved.value);
    logAudit({ user: req.user, module: 'Sales', action: 'SHIPPING_PAYOUT_CONFIRMED', record_id: id,
      before_data: sale, after_data: { ...updated, collection_difference },
      description: `تحويل حجز إلى صرف: ${sale.client} - ${sale.order_number} — المتبقي: ${sale.remaining} — المستلم فعليًا: ${resolved.value} — الفرق غير المحصل: ${collection_difference}` });
    return res.json({ ...updated, collection_difference });
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في تحويل الحجز' });
  }
});

// POST /api/sales/:id/cancel-reservation — تم الحجز → تم الإلغاء
router.post('/:id/cancel-reservation', requireManager, async (req: Request, res: Response) => {
  try {
    const seasonId = await getSeasonId(req);
    const id = parseInt(req.params.id as string);
    const sale = await prisma.sale.findFirst({ where: { id, season_id: seasonId } });
    if (!sale) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (sale.order_status !== 'تم الحجز') {
      return res.status(400).json({ message: 'هذا الطلب ليس حجزاً' });
    }

    // Release the reservation; physical stock is unchanged (the goods never left).
    const slots = extractModels(sale as unknown as Record<string, unknown>);
    const updated = await prisma.$transaction(async (tx) => {
      await lockStock(tx, seasonId);
      const current = await tx.sale.findFirst({ where: { id, season_id: seasonId } });
      if (!current || current.order_status !== STATUS_RESERVED) throw new StockError('هذا الطلب ليس حجزاً');
      const upd = await tx.sale.update({ where: { id }, data: { order_status: STATUS_CANCELED, cancel_disposition: null, requested_status: null } });
      await syncReserved(tx, seasonId, slots);
      await recordCancellation(tx, {
        seasonId, sale: upd, statusBefore: STATUS_RESERVED, wasShipped: false, disposition: null, reason: '',
        snapshot: { qty: 0, cost: 0 }, user: req.user?.username,
      });
      return upd;
    });
    logStockMovement(req.user, 'STOCK_RELEASED', sale, slots, 'فك حجز مخزون (إلغاء)');
    logAudit({ user: req.user, module: 'Sales', action: 'UPDATE', record_id: id,
      before_data: sale, after_data: updated, description: `إلغاء حجز: ${sale.client} - ${sale.order_number}` });
    return res.json(updated);
  } catch (err) {
    if (err instanceof StockError) return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ message: 'خطأ في إلغاء الحجز' });
  }
});

export default router;

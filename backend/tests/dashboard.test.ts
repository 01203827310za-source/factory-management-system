// Acceptance tests for the MAIN Dashboard endpoint (GET /api/dashboard → لوحة التحكم).
// The real route handler runs; only the database is replaced by in-memory rows, so the figures
// asserted here are exactly what the Dashboard cards and the «عرض تفاصيل الحساب» modal receive.
import path from 'node:path';
import { assert, test } from './harness';
import { World } from './world';
import { M1, NOT_PAID_OUT, PAID_OUT, PREPARED, scenario, acct, invoice } from './fixtures';

type Row = { season_id: number };
type Json = Record<string, unknown> & {
  stock_value: number; stock_reserved_value: number; stock_available_value: number; money_owed_to_us: number;
  total_current_assets: number; total_in: number; total_out: number; net_profit: number; cash_available: number;
  cash_on_hand: number; cash_items: { key: string; amount: number; direction: 'in' | 'out' }[];
  receivable_overlap_orders: number; receivable_overlap_amount: number;
  assets_reconciliation: { reconciled: boolean; components_sum: number; differences: Record<string, number> };
  receivable_items: { source: string; reference: string; remaining: number; stock_status?: string; inventory_still_in_stock?: boolean; duplicate_in_client_account?: boolean }[];
  stock_items: { actual_qty: number; reserved_qty: number; available_qty: number; total: number; pending_qty: number }[];
  pending_orders: { order_number: string; requested: number; reserved: number; pending: number }[];
  pending_units: number; advances_on_open_reservations: number;
  missing_stock: { total_missing_units: number; total_rows: number; rows: { model_code: string; color: string; required: number; reserved: number; missing: number; orders: { order_number: string; missing: number }[] }[] };
  shipping_receivable: number; client_accounts_receivable: number;
};

/** Runs the real Dashboard handler against `data` for the requested season. */
async function callDashboard(data: Record<string, Row[]>, seasonId: number): Promise<Json> {
  const rows = (name: string) => async (a?: { where?: { season_id?: number } }) =>
    (data[name] ?? []).filter(r => a?.where?.season_id === undefined || r.season_id === a.where.season_id);
  const model = (name: string) => ({ findMany: rows(name) });
  const fakePrisma = {
    season: { findUnique: async (a: { where: { id: number } }) => ({ id: a.where.id }), findFirst: async () => ({ id: 1 }) },
    sale: model('sales'), expenseRevenue: model('expenses'), debt: model('debts'), clientAccount: model('clientAccts'),
    returnItem: model('returns'), paymentLog: model('paymentLogs'), fabricWarehouse: model('fabric'), readyStock: model('readyStock'),
    accessoriesWarehouse: model('accessories'), cuttingOrder: model('cutting'), modelPart: model('modelParts'),
    modelProduction: model('modelProds'), inventoryMovement: model('movements'), clientAccountInvoice: model('clientInvoices'),
    financialSnapshot: { upsert: async () => ({}) },
  };

  // Load the route fresh with the fake Prisma installed.
  const prismaPath = require.resolve('../src/lib/prisma');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { __esModule: true, default: fakePrisma, prisma: fakePrisma } } as unknown as NodeJS.Module;
  const srcDir = path.resolve(__dirname, '..', 'src') + path.sep;
  Object.keys(require.cache).filter(k => k.startsWith(srcDir) && k !== prismaPath).forEach(k => { delete require.cache[k]; });
  const router = require('../src/routes/dashboard').default as { stack: { route?: { path: string; methods: { get?: boolean }; stack: { handle: (req: unknown, res: unknown) => Promise<void> }[] } }[] };

  const layer = router.stack.find(l => l.route?.path === '/' && l.route.methods.get);
  assert.ok(layer?.route, 'GET / handler exists');
  let body: unknown; let status = 200;
  const res = { status(c: number) { status = c; return this; }, json(b: unknown) { body = b; return this; } };
  const req = { header: (n: string) => (n.toLowerCase() === 'x-season-id' ? String(seasonId) : undefined), query: {} };
  await layer.route.stack[0].handle(req, res);
  assert.equal(status, 200, `dashboard responded ${status}: ${JSON.stringify(body)}`);
  return body as Json;
}

const dataOf = (w: World, extra: Partial<Record<string, Row[]>> = {}) => ({
  sales: w.sales, readyStock: w.readyStock, modelProds: w.modelProds, returns: w.returns, movements: w.movements, ...extra,
}) as Record<string, Row[]>;

test('Dashboard: stock = physical (shipped removed once, reserved kept); receivables = valid outstanding only', async () => {
  const { w, clientAccts, clientInvoices } = await scenario();
  const d = await callDashboard(dataOf(w, { clientAccts, clientInvoices }), 1);

  // 200 pcs @600: shipped 10+5+4+3 = 22 left the building; 20 reserved stay in it → 178 pcs
  assert.equal(d.stock_value, 178 * 600);
  assert.equal(d.stock_reserved_value, 20 * 600);
  assert.equal(d.stock_available_value, 158 * 600);
  assert.equal(d.stock_reserved_value + d.stock_available_value, d.stock_value);   // never double counted
  assert.deepEqual(d.stock_items.map(i => [i.actual_qty, i.reserved_qty, i.available_qty]), [[178, 20, 158]]);

  // owed: 8,000 (SO-1) + 0 (SO-2 customer credit) + 5,000 (SO-3) + 300 (SO-5 gap) + 5,000 client account
  assert.equal(d.money_owed_to_us, 18300);
  assert.equal(d.shipping_receivable, 13300);
  assert.equal(d.client_accounts_receivable, 5000);
  assert.deepEqual(d.receivable_items.map(i => [i.source, i.reference, i.remaining]),
    [['sale', 'SO-1', 8000], ['sale', 'SO-3', 5000], ['sale_shipping_gap', 'SO-5', 300], ['client_account', '', 5000]]);
  // the reserved order SO-4 (6,000) and the over-paid SO-2 are not receivables
  assert.equal(d.receivable_items.some(i => i.reference === 'SO-4' || i.reference === 'SO-2'), false);
});

test('Dashboard: shipped receivables are not still in stock; the same debt entered twice is flagged', async () => {
  const { w, clientAccts, clientInvoices } = await scenario();
  const d = await callDashboard(dataOf(w, { clientAccts, clientInvoices }), 1);
  const sale = d.receivable_items.filter(i => i.source !== 'client_account');
  assert.equal(sale.every(i => i.inventory_still_in_stock === false), true);
  assert.equal(sale.every(i => i.stock_status === 'removed'), true);
  assert.deepEqual(sale.filter(i => i.duplicate_in_client_account).map(i => i.reference), ['SO-3']);
  assert.deepEqual([d.receivable_overlap_orders, d.receivable_overlap_amount], [1, 5000]);
});

test('Dashboard: invoices never become cash; only deposits and amounts actually collected do', async () => {
  const { w, clientAccts, clientInvoices } = await scenario();
  const d = await callDashboard(dataOf(w, { clientAccts, clientInvoices }), 1);
  // deposits 2,000 (SO-1) + 3,500 (SO-2) + collected 8,200 (SO-5). Invoices of 32,500 never enter cash.
  assert.equal(d.total_in, 13700);
  assert.equal(d.net_profit, 13700);
  // cash and receivables are disjoint: SO-5 invoice 8,500 = 8,200 in cash + 300 owed
  assert.equal(d.receivable_items.find(i => i.reference === 'SO-5')?.remaining, 300);
});

test('Dashboard: the «إجمالي الأصول الحالية» total reconciles with every component and its detail rows', async () => {
  const { w, clientAccts, clientInvoices } = await scenario();
  const d = await callDashboard(dataOf(w, { clientAccts, clientInvoices }), 1);
  assert.equal(d.assets_reconciliation.reconciled, true);
  assert.deepEqual(Object.values(d.assets_reconciliation.differences).map(Math.abs), [0, 0, 0, 0, 0, 0, 0]);   // cash + 6 other components
  assert.equal(d.total_current_assets, d.assets_reconciliation.components_sum);
  // real cash 13,700 (deposits 2,000 + 3,500 + collected 8,200) + stock 178 pcs + valid receivables 18,300
  assert.equal(d.total_current_assets, d.cash_on_hand + 178 * 600 + 18300);
  assert.equal(d.cash_on_hand, 13700);
});

test('Dashboard: reserving alone leaves total current assets unchanged', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 1000);
  const before = await callDashboard(dataOf(w), 1);
  await w.saveOrder({ status: PREPARED, slots: [M1], invoice: 8500 });
  const after = await callDashboard(dataOf(w), 1);
  assert.equal(before.total_current_assets, 100000);
  assert.equal(after.total_current_assets, before.total_current_assets);
  assert.deepEqual([after.stock_available_value, after.stock_reserved_value], [90000, 10000]);
  assert.equal(after.money_owed_to_us, 0);              // a reservation is not a receivable
});

test('Dashboard: shipping removes cost from stock and adds only the valid receivable (no netting)', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600);
  const o = await w.saveOrder({ status: PREPARED, slots: [M1], invoice: 8500 });
  await w.saveOrder({ id: o.id, status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });
  const d = await callDashboard(dataOf(w), 1);
  assert.equal(d.stock_value, 90 * 600);                // −6,000 once
  assert.equal(d.money_owed_to_us, 8500);               // full receivable, NOT 8,500 − 6,000
  assert.equal(d.total_in, 0);                          // no cash until collected
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, collected: 8200, date: '2026-10-05' });
  const paid = await callDashboard(dataOf(w), 1);
  assert.equal(paid.stock_value, 90 * 600);             // payout does not deduct stock again
  assert.equal(paid.total_in, 8200);
  assert.equal(paid.money_owed_to_us, 300);
  assert.equal(paid.assets_reconciliation.reconciled, true);
});

test('Dashboard: a colour mismatch (shipped goods still valued in stock) is surfaced on the receivable row', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600);
  await w.saveOrder({ legacy: true, order_number: 'SO-9', status: NOT_PAID_OUT, slots: [{ code: 'M1', qty: 10, color: 'ازرق' }], invoice: 7000 });
  const d = await callDashboard(dataOf(w), 1);
  const row = d.receivable_items.find(i => i.reference === 'SO-9');
  assert.equal(row?.remaining, 7000);
  assert.equal(row?.inventory_still_in_stock, true);
  assert.equal(row?.stock_status, 'possible_mismatch');
  assert.equal(d.stock_value, 50 * 600);                // those 10 pieces are still valued → flagged, not hidden
});

test('Dashboard: season isolation — each season sees only its own stock, receivables and assets', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600, 1);
  w.addStock('M1', 'أسود', 40, 800, 2);
  await w.saveOrder({ season: 1, status: NOT_PAID_OUT, slots: [M1], invoice: 8500 });
  await w.saveOrder({ season: 2, status: NOT_PAID_OUT, slots: [{ ...M1, qty: 5 }], invoice: 4000 });
  const clientAccts = [{ ...acct(1, 777), season_id: 2 }];
  const clientInvoices = [{ ...invoice(1, 1, 'ZZ', 1), season_id: 2 }];
  const data = dataOf(w, { clientAccts, clientInvoices });
  const s1 = await callDashboard(data, 1);
  const s2 = await callDashboard(data, 2);
  assert.deepEqual([s1.stock_value, s1.money_owed_to_us], [90 * 600, 8500]);
  assert.deepEqual([s2.stock_value, s2.money_owed_to_us], [35 * 800, 4000 + 777]);
  assert.equal(s1.assets_reconciliation.reconciled && s2.assets_reconciliation.reconciled, true);
});

test('Dashboard: an under-stocked «يتم التجهيز» order — only real stock is an asset; the shortage is a pending list', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 4, 600);
  await w.saveOrder({ order_number: 'P-1', status: PREPARED, slots: [{ ...M1, qty: 10 }], invoice: 8500, deposit: 1000 });
  const d = await callDashboard(dataOf(w), 1);
  assert.equal(d.stock_value, 4 * 600);                         // the 6 missing pieces are NOT assets
  assert.equal(d.total_current_assets, 4 * 600 + 1000);         // 4 real pieces + the 1,000 deposit actually received
  assert.equal(d.money_owed_to_us, 0);                          // a prepared order is not a receivable
  assert.equal(d.total_in, 1000);                               // only the deposit is real cash…
  assert.equal(d.advances_on_open_reservations, 1000);          // …and it is shown as an obligation
  assert.deepEqual(d.stock_items.map(i => [i.actual_qty, i.reserved_qty, i.available_qty, i.pending_qty]), [[4, 4, 0, 6]]);
  assert.deepEqual(d.pending_orders.map(o => [o.order_number, o.requested, o.reserved, o.pending]), [['P-1', 10, 4, 6]]);
  assert.equal(d.pending_units, 6);
  assert.equal(d.assets_reconciliation.reconciled, true);
});

test('Dashboard: zero stock — order accepted, nothing reserved, nothing invented', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 0, 600);
  await w.saveOrder({ order_number: 'P-2', status: PREPARED, slots: [{ ...M1, qty: 10 }], invoice: 8500 });
  const d = await callDashboard(dataOf(w), 1);
  assert.equal(d.total_current_assets, 0);
  assert.deepEqual(d.pending_orders.map(o => [o.reserved, o.pending]), [[0, 10]]);
  assert.equal(d.assets_reconciliation.reconciled, true);
});

test('Dashboard: «ملخص النواقص» groups shortages by model + colour, deducts reservations, and is stable across requests', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 6, 100); w.addStock('1001', 'نبيتي', 0, 100); w.addStock('1002', 'أبيض', 0, 100);
  await w.saveOrder({ order_number: 'A', status: PREPARED, slots: [{ code: '1001', qty: 10, color: 'أسود' }], invoice: 1 });   // 6 held, 4 missing
  await w.saveOrder({ order_number: 'B', status: PREPARED, slots: [{ code: '1001', qty: 8, color: 'أسود' }], invoice: 1 });    // 8 missing
  await w.saveOrder({ order_number: 'C', status: PREPARED, slots: [{ code: '1001', qty: 18, color: 'نبيتي' }], invoice: 1 });
  await w.saveOrder({ order_number: 'D', status: PREPARED, slots: [{ code: '1002', qty: 12, color: 'أبيض' }], invoice: 1 });
  const d1 = await callDashboard(dataOf(w), 1);
  const d2 = await callDashboard(dataOf(w), 1);
  assert.deepEqual(d1.missing_stock, d2.missing_stock);                                       // repeated requests: identical
  assert.deepEqual(d1.missing_stock.rows.map(r => [r.model_code, r.color, r.required, r.reserved, r.missing]),
    [['1001', 'نبيتي', 18, 0, 18], ['1001', 'أسود', 18, 6, 12], ['1002', 'أبيض', 12, 0, 12]]);
  assert.equal(d1.missing_stock.total_missing_units, 42);
  assert.deepEqual(d1.missing_stock.rows[1].orders.map(o => [o.order_number, o.missing]), [['A', 4], ['B', 8]]);
  // consistent with the existing per-order list on the same Dashboard
  assert.equal(d1.pending_units, d1.missing_stock.total_missing_units);
  assert.equal(d1.stock_value, 6 * 100);                                                      // only the 6 that exist are assets
});

test('Dashboard: «ملخص النواقص» is per season', async () => {
  const w = new World();
  w.addStock('1001', 'أسود', 0, 100, 1); w.addStock('1001', 'أسود', 0, 100, 2);
  await w.saveOrder({ season: 1, order_number: 'S1', status: PREPARED, slots: [{ code: '1001', qty: 9, color: 'أسود' }], invoice: 1 });
  await w.saveOrder({ season: 2, order_number: 'W1', status: PREPARED, slots: [{ code: '1001', qty: 5, color: 'أسود' }], invoice: 1 });
  const data = dataOf(w);
  assert.deepEqual((await callDashboard(data, 1)).missing_stock.rows.map(r => r.missing), [9]);
  assert.deepEqual((await callDashboard(data, 2)).missing_stock.rows.map(r => r.missing), [5]);
});

// ───────────── actual cash in the safe («الصافي») inside current assets ─────────────
const extras = {
  expenses: [{ season_id: 1, amount_in: 50000, amount_out: 8000 }],
  paymentLogs: [{ season_id: 1, type: 'debt_payment', amount: 1000 }, { season_id: 1, type: 'client_payment', amount: 500 }],
  debts: [{ season_id: 1, remaining: 3000 }],
} as unknown as Record<string, Row[]>;

async function cashWorld() {
  const w = new World();
  w.addStock('M1', 'أسود', 100, 600);
  const o = await w.saveOrder({ order_number: 'C-1', status: NOT_PAID_OUT, slots: [M1], invoice: 8500, deposit: 1000 });   // 7,500 owed
  return { w, o };
}

test('Dashboard cash: «الصافي» = total in − total out is the actual cash, and is added to current assets once', async () => {
  const { w } = await cashWorld();
  const d = await callDashboard(dataOf(w, extras), 1);
  // derived from the inputs (nothing hardcoded): in = 50,000 + deposit 1,000 + client 500; out = 8,000 + debt payment 1,000
  const expectedCash = (50000 + 1000 + 500) - (8000 + 1000);
  assert.equal(d.cash_on_hand, expectedCash);
  assert.equal(d.cash_on_hand, d.net_profit);                                   // the top table's «الصافي»
  assert.equal(d.cash_on_hand, d.total_in - d.total_out);
  assert.equal(d.cash_items.reduce((n, i) => n + (i.direction === 'in' ? i.amount : -i.amount), 0), d.cash_on_hand);
  // exactly once: total = cash + stock + valid receivables, nothing else, nothing twice
  assert.equal(d.total_current_assets, expectedCash + 90 * 600 + 7500);
  assert.equal(d.assets_reconciliation.reconciled, true);
});

test('Dashboard cash: «الكاش الفعلي بالخزنة» stays separate from «الكاش المتاح»', async () => {
  const { w } = await cashWorld();
  const d = await callDashboard(dataOf(w, extras), 1);
  assert.equal(d.cash_available, d.cash_on_hand - 3000);                        // «المتاح» also subtracts outstanding debts
  assert.notEqual(d.cash_available, d.cash_on_hand);
  assert.equal(d.total_current_assets - d.cash_on_hand, 90 * 600 + 7500);       // the asset total uses the actual cash, not «المتاح»
});

test('Dashboard cash: receivables stay out of cash until collected, then move (never counted twice)', async () => {
  const { w, o } = await cashWorld();
  const before = await callDashboard(dataOf(w), 1);
  assert.equal(before.cash_on_hand, 1000);                                      // only the deposit is real cash
  assert.equal(before.money_owed_to_us, 7500);                                  // the rest is a receivable, not cash
  await w.saveOrder({ id: o.id, status: PAID_OUT, slots: [M1], invoice: 8500, deposit: 1000, collected: 7000, date: '2026-10-05' });
  const after = await callDashboard(dataOf(w), 1);
  assert.equal(after.cash_on_hand, 1000 + 7000);                                // collected money became cash…
  assert.equal(after.money_owed_to_us, 500);                                    // …and left the receivable
  // moving 7,000 from "owed" to "cash" must not change total current assets
  assert.equal(after.total_current_assets, before.total_current_assets);
  assert.equal(after.assets_reconciliation.reconciled, true);
});

test('Dashboard cash: an uncollected invoice, a prepared order and a pending shortage add no cash', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 4, 600);
  await w.saveOrder({ status: PREPARED, slots: [{ ...M1, qty: 10 }], invoice: 9999 });     // no deposit
  await w.saveOrder({ status: NOT_PAID_OUT, slots: [{ ...M1, qty: 4 }], invoice: 5000 }).catch(() => undefined); // refused (reserved) → still nothing
  const d = await callDashboard(dataOf(w), 1);
  assert.equal(d.cash_on_hand, 0);
  assert.equal(d.total_current_assets, 4 * 600);
});

test('Dashboard cash: each season has its own cash', async () => {
  const w = new World();
  w.addStock('M1', 'أسود', 50, 600, 1); w.addStock('M1', 'أسود', 50, 600, 2);
  await w.saveOrder({ season: 1, status: PREPARED, slots: [M1], invoice: 1000, deposit: 300 });
  await w.saveOrder({ season: 2, status: PREPARED, slots: [M1], invoice: 1000, deposit: 700 });
  const s1 = await callDashboard(dataOf(w), 1);
  const s2 = await callDashboard(dataOf(w), 2);
  assert.deepEqual([s1.cash_on_hand, s2.cash_on_hand], [300, 700]);
  assert.deepEqual([s1.total_current_assets, s2.total_current_assets], [50 * 600 + 300, 50 * 600 + 700]);
});

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
  total_current_assets: number; total_in: number; net_profit: number; cash_available: number;
  receivable_overlap_orders: number; receivable_overlap_amount: number;
  assets_reconciliation: { reconciled: boolean; components_sum: number; differences: Record<string, number> };
  receivable_items: { source: string; reference: string; remaining: number; stock_status?: string; inventory_still_in_stock?: boolean; duplicate_in_client_account?: boolean }[];
  stock_items: { actual_qty: number; reserved_qty: number; available_qty: number; total: number }[];
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
  assert.deepEqual(Object.values(d.assets_reconciliation.differences).map(Math.abs), [0, 0, 0, 0, 0, 0]);
  assert.equal(d.total_current_assets, d.assets_reconciliation.components_sum);
  assert.equal(d.total_current_assets, 178 * 600 + 18300);
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
  await w.saveOrder({ order_number: 'SO-9', status: NOT_PAID_OUT, slots: [{ code: 'M1', qty: 10, color: 'ازرق' }], invoice: 7000 });
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

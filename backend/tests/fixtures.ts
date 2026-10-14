// Shared scenario for the receivables / Dashboard tests.
import type { ClientAccount, ClientAccountInvoice } from '@prisma/client';
import { World } from './world';

export const M1 = { code: 'M1', qty: 10, color: 'أسود' };
export const NOT_PAID_OUT = 'لم يتم الصرف';
export const PAID_OUT = 'تم الصرف';
export const PREPARED = 'تم الحجز';

export const acct = (id: number, remaining: number): ClientAccount => ({
  id, season_id: 1, date: '2026-10-01', client_name: `عميل ${id}`, model_name: '', quantity: 0,
  total_amount: remaining, amount_paid: 0, remaining, notes: '', created_at: new Date(),
});
export const invoice = (id: number, account_id: number, order_number: string, amount: number): ClientAccountInvoice => ({
  id, season_id: 1, account_id, date: '2026-10-02', order_number, amount, notes: '', created_by: '', created_at: new Date(),
});

export async function scenario() {
  const w = new World();
  w.addStock('M1', 'أسود', 200, 600);
  // O1 valid: shipped, deposit 2,000 → owes 8,000
  const o1 = await w.saveOrder({ order_number: 'SO-1', status: NOT_PAID_OUT, slots: [M1], invoice: 10000, deposit: 2000 });
  // O2: customer paid MORE than the invoice (deposit 3,500 > 3,000) → a credit, not a receivable
  const o2 = await w.saveOrder({ order_number: 'SO-2', status: NOT_PAID_OUT, slots: [{ ...M1, qty: 5 }], invoice: 3000, deposit: 3500 });
  // O3: shipped, 5,000 owed — and the same order was ALSO entered as a client-account invoice
  const o3 = await w.saveOrder({ order_number: 'SO-3', status: NOT_PAID_OUT, slots: [{ ...M1, qty: 4 }], invoice: 5000 });
  // O4: prepared (reserved, still in the warehouse) — must not be a receivable
  const o4 = await w.saveOrder({ order_number: 'SO-4', status: PREPARED, slots: [{ ...M1, qty: 20 }], invoice: 6000 });
  // O5: paid out partly: 8,200 of 8,500 → 300 still owed
  const o5 = await w.saveOrder({ order_number: 'SO-5', status: PAID_OUT, slots: [{ ...M1, qty: 3 }], invoice: 8500, collected: 8200, date: '2026-10-05' });
  const clientAccts = [acct(1, 5000)];
  const clientInvoices = [invoice(1, 1, 'SO-3', 5000)];
  return { w, o1, o2, o3, o4, o5, clientAccts, clientInvoices };
}


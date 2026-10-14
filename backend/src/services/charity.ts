// ============================================
// Monthly charity (صدقة الشهر) — pure calculation helpers
//
// Business rule (user-configured, do not alter):
//   charity_due = actual_monthly_shipping_collections × rate(total)
//   total <  200,000            → 1%
//   200,000 ≤ total <  400,000  → 1.5%
//   400,000 ≤ total ≤  800,000  → 2%
//   total >  800,000            → 3%
// "Actual shipping collections" = sales.shipping_collected of orders in status
// 'تم الصرف', assigned to the month of sales.shipping_collected_date.
// ============================================

import type { Sale } from '@prisma/client';

export const STATUS_DISPATCHED = 'تم الصرف';
export const CHARITY_OPERATION_TYPE = 'صدقة';

const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Today's calendar date (YYYY-MM-DD) in Cairo — the factory's business day. */
export function cairoToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** Rate (as a fraction) applied to a month's total actual shipping collections. */
export function charityRate(total: number): number {
  const t = round2(total);
  if (t < 200000) return 0.01;
  if (t < 400000) return 0.015;
  if (t <= 800000) return 0.02;
  return 0.03;
}

export function charityDue(total: number): { rate: number; due: number } {
  const rate = charityRate(total);
  return { rate, due: round2(round2(total) * rate) };
}

/**
 * Month a dispatched order's money belongs to. Orders confirmed before the payout-date
 * column existed have no recorded date; they fall back to the order's creation day and
 * are flagged `estimated` so the UI can say so — nothing is written back to the order.
 */
export function collectionMonth(sale: Pick<Sale, 'shipping_collected_date' | 'created_at'>): { month: string; estimated: boolean } {
  if (sale.shipping_collected_date && isValidDate(sale.shipping_collected_date)) {
    return { month: sale.shipping_collected_date.slice(0, 7), estimated: false };
  }
  return { month: sale.created_at.toISOString().slice(0, 7), estimated: true };
}

export type MonthCollections = { month: string; total: number; order_count: number; estimated_total: number; estimated_count: number };

/** Σ shipping_collected per month for dispatched orders of one season. */
export function collectionsByMonth(sales: Sale[]): Map<string, MonthCollections> {
  const out = new Map<string, MonthCollections>();
  for (const s of sales) {
    if (s.order_status !== STATUS_DISPATCHED || s.shipping_collected <= 0) continue;
    const { month, estimated } = collectionMonth(s);
    const cur = out.get(month) ?? { month, total: 0, order_count: 0, estimated_total: 0, estimated_count: 0 };
    cur.total += s.shipping_collected;
    cur.order_count += 1;
    if (estimated) { cur.estimated_total += s.shipping_collected; cur.estimated_count += 1; }
    out.set(month, cur);
  }
  return out;
}

export type CharityStatus = 'none_due' | 'unpaid' | 'partial' | 'paid';
export const STATUS_LABELS: Record<CharityStatus, string> = {
  none_due: 'لا يوجد مستحق',
  unpaid: 'لم تُصرف',
  partial: 'صُرف جزء منها',
  paid: 'تم الصرف بالكامل',
};

export function charityStatus(due: number, paid: number): CharityStatus {
  if (due <= 0 && paid <= 0) return 'none_due';
  if (paid <= 0) return 'unpaid';
  return round2(paid) >= round2(due) ? 'paid' : 'partial';
}

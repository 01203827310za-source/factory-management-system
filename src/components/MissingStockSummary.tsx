import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ClipboardCopy, Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useToast } from './Toast';
import type { MissingStockSummaryData } from '../types';

const fmt = (n: number) => n.toLocaleString('ar-EG');
type SortMode = 'missing' | 'model';

/**
 * «ملخص النواقص المطلوبة للتجهيز» — pieces still to be produced / purchased, per model code + colour,
 * across every «يتم التجهيز» order. All figures come from the backend allocation (GET /api/dashboard),
 * so a unit reserved for one order is never counted as a shortage of another.
 */
export default function MissingStockSummary({ summary }: { summary: MissingStockSummaryData }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('missing');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = summary.rows.filter(r => !q
      || r.model_code.toLowerCase().includes(q) || r.model_name.toLowerCase().includes(q) || r.color.toLowerCase().includes(q));
    return [...filtered].sort(sort === 'missing'
      ? (a, b) => b.missing - a.missing || a.model_code.localeCompare(b.model_code)
      : (a, b) => a.model_code.localeCompare(b.model_code) || a.color.localeCompare(b.color));
  }, [summary.rows, search, sort]);

  const shownMissing = rows.reduce((n, r) => n + r.missing, 0);
  const keyOf = (r: { model_code: string; color: string }) => `${r.model_code}|${r.color}`;
  const toggle = (k: string) => setOpen(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  const label = (r: { model_code: string; model_name: string; color: string }) =>
    `${r.model_code}${r.model_name ? ` (${r.model_name})` : ''}${r.color ? ` — ${r.color}` : ''}`;

  const copy = async () => {
    const text = [
      'ملخص النواقص المطلوبة للتجهيز',
      ...rows.map(r => `${label(r)}: ${r.missing} قطعة`),
      `الإجمالي: ${shownMissing} قطعة`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); toast('success', 'تم نسخ قائمة النواقص'); }
    catch { toast('error', 'تعذر النسخ — استخدم التصدير'); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'كود الموديل': r.model_code, 'اسم الموديل': r.model_name, 'اللون': r.color,
      'المطلوب': r.required, 'المحجوز لها': r.reserved, 'الناقص': r.missing,
      'الأوردرات': r.orders.map(o => `${o.order_number} (${o.missing})`).join('، '),
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'النواقص');
    XLSX.writeFile(wb, 'missing_stock.xlsx');
  };

  return (
    <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <h2 className="text-base font-bold text-red-800">ملخص النواقص المطلوبة للتجهيز</h2>
          <p className="text-xs text-gray-500">القطع الناقصة فعليًا لكل موديل ولون عبر كل أوردرات «يتم التجهيز» (بعد خصم المحجوز من المخزون الموجود)</p>
        </div>
        <div className="text-left">
          <p className="text-xs text-gray-500">إجمالي القطع الناقصة</p>
          <p className="text-2xl font-bold text-red-700">{fmt(summary.total_missing_units)}</p>
          <p className="text-xs text-gray-400">{fmt(summary.total_rows)} موديل/لون · {fmt(summary.total_orders)} أوردر</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative">
          <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالكود أو الاسم أو اللون..."
            className="border border-gray-300 rounded-lg pr-8 pl-3 py-1.5 text-sm w-60 focus:outline-none focus:ring-2 focus:ring-red-300"
            aria-label="بحث في النواقص"
          />
        </div>
        <select
          value={sort} onChange={e => setSort(e.target.value as SortMode)}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300"
          aria-label="ترتيب النواقص"
        >
          <option value="missing">الأعلى نقصًا أولًا</option>
          <option value="model">حسب الموديل واللون</option>
        </select>
        <button onClick={copy} disabled={rows.length === 0} className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">
          <ClipboardCopy size={14} /> نسخ القائمة
        </button>
        <button onClick={exportExcel} disabled={rows.length === 0} className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">
          <Download size={14} /> تصدير Excel
        </button>
        {search && <span className="text-xs text-gray-500">المعروض: {fmt(shownMissing)} قطعة</span>}
      </div>

      {rows.length === 0 ? (
        <p className="text-center py-6 text-sm text-gray-400">لا توجد نتائج مطابقة</p>
      ) : (
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="w-8" />
                {['الموديل', 'الاسم', 'اللون', 'المطلوب', 'محجوز لها', 'الناقص'].map(h => <th key={h} className="text-right px-3 py-2 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const k = keyOf(r);
                const isOpen = open.has(k);
                return (
                  <Fragment key={k}>
                    <tr className="hover:bg-red-50/40 cursor-pointer" onClick={() => toggle(k)}>
                      <td className="px-2 py-2 text-gray-400">
                        <button aria-label={isOpen ? 'إخفاء الأوردرات' : 'عرض الأوردرات'} aria-expanded={isOpen} className="p-0.5">
                          {isOpen ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.model_code}</td>
                      <td className="px-3 py-2 text-gray-600">{r.model_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{r.color || '—'}</td>
                      <td className="px-3 py-2">{fmt(r.required)}</td>
                      <td className="px-3 py-2 text-orange-700">{fmt(r.reserved)}</td>
                      <td className="px-3 py-2 font-bold text-red-700">{fmt(r.missing)} قطعة</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-red-50/30">
                        <td />
                        <td colSpan={6} className="px-3 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-500">
                                {['الأوردر', 'العميل', 'المطلوب', 'محجوز', 'الناقص'].map(h => <th key={h} className="text-right px-2 py-1 font-semibold">{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {r.orders.map(o => (
                                <tr key={o.sale_id} className="border-t border-red-100">
                                  <td className="px-2 py-1 font-medium text-gray-800">#{o.sale_id} · {o.order_number}</td>
                                  <td className="px-2 py-1 text-gray-600">{o.client}</td>
                                  <td className="px-2 py-1">{fmt(o.requested)}</td>
                                  <td className="px-2 py-1 text-orange-700">{fmt(o.reserved)}</td>
                                  <td className="px-2 py-1 font-semibold text-red-700">{fmt(o.missing)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="text-xs text-gray-500 mt-2">
                            {r.has_card
                              ? <>المخزون الفعلي لهذا الموديل/اللون: <strong>{fmt(r.physical_stock)}</strong> — كله محجوز
                                  {r.reserved_for_covered_orders > 0 && <> (منه <strong>{fmt(r.reserved_for_covered_orders)}</strong> لأوردرات أخرى مكتملة)</>}
                                  ، ولا يوجد مخزون حر ({fmt(r.free_stock)}).</>
                              : <>لا يوجد كارت مخزون لهذا الموديل/اللون بعد — لم يُنتج أو يُشترَ.</>}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400 mt-2">الكميات الناقصة لم تُنتج أو تُشترَ بعد، فلا تدخل في المخزون ولا في الأصول.</p>
    </div>
  );
}

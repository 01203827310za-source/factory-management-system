import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronLeft, RefreshCw, Shirt } from 'lucide-react';
import { dashboardApi, type MonthlyModelSales as MonthlyModelSalesData } from '../services/api';

const fmt = (n: number) => n.toLocaleString('ar-EG');
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MONTHS[Number(mm) - 1] ?? mm} ${y}`; };
const currentMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);

type SortKey = 'model_code' | 'qty';

/** «المبيعات الشهرية حسب الموديل» — pieces sold per model, from orders currently «تم الصرف», by the month they were paid out. */
export default function MonthlyModelSales() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<MonthlyModelSalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('qty');
  const [desc, setDesc] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let alive = true;
    setLoading(true); setError('');
    dashboardApi.getMonthlySales(month)
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) { setData(null); setError(e instanceof Error ? e.message : 'تعذر تحميل المبيعات الشهرية'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    list.sort((a, b) => {
      const r = sortKey === 'qty' ? a.qty - b.qty : a.model_code.localeCompare(b.model_code, 'ar', { numeric: true });
      return desc ? -r : r;
    });
    return list;
  }, [data, sortKey, desc]);

  const toggleSort = (k: SortKey) => { if (sortKey === k) setDesc(!desc); else { setSortKey(k); setDesc(k === 'qty'); } };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Shirt size={20} className="text-blue-600" /> المبيعات الشهرية حسب الموديل</h2>
          <p className="text-xs text-gray-500 mt-0.5">القطع من أوردرات حالتها الحالية «تم الصرف» فقط، بشهر تسجيل الصرف — {month && /^\d{4}-\d{2}$/.test(month) ? monthLabel(month) : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" className="border rounded-lg px-3 py-1.5 text-sm" value={month} max="2100-12" min="2000-01" onChange={e => setMonth(e.target.value)} aria-label="الشهر" />
          <button type="button" className="border rounded-lg px-2 py-1.5 text-xs" onClick={() => setMonth(currentMonth())}>الشهر الحالي</button>
        </div>
      </div>

      {loading && <div className="flex items-center justify-center py-10 text-gray-400 text-sm"><RefreshCw size={18} className="animate-spin ml-2" /> جارٍ التحميل...</div>}
      {!loading && error && <p className="text-center py-8 text-sm text-red-600">{error}</p>}
      {!loading && !error && data && (
        rows.length === 0 ? (
          <p className="text-center py-8 text-sm text-gray-400">لا توجد أوردرات «تم الصرف» في {monthLabel(data.month)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-right px-4 py-3 font-semibold">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('model_code')}>كود الموديل <ArrowUpDown size={12} /></button>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">اسم الموديل</th>
                  <th className="text-center px-4 py-3 font-semibold">
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort('qty')}>القطع المباعة <ArrowUpDown size={12} /></button>
                  </th>
                  <th className="text-center px-4 py-3 font-semibold">الأوردرات</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-400">كل الشهور</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.model_code}>
                    <tr className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(open === r.model_code ? null : r.model_code)}>
                      <td className="px-4 py-3 font-semibold text-gray-800">
                        <span className="inline-flex items-center gap-1">{open === r.model_code ? <ChevronDown size={14} /> : <ChevronLeft size={14} />}{r.model_code}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.model_name || '—'}</td>
                      <td className="px-4 py-3 text-center font-bold text-blue-700">{fmt(r.qty)}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{fmt(r.order_count)}</td>
                      <td className="px-4 py-3 text-center text-gray-400">{fmt(r.all_time_qty)}</td>
                    </tr>
                    {open === r.model_code && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={5} className="px-6 py-2 text-xs text-gray-600">
                          {r.colors.map(c => <span key={c.color} className="inline-block ml-4">{c.color || 'بدون لون'}: <strong>{fmt(c.qty)}</strong></span>)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-3" colSpan={2}>الإجمالي</td>
                  <td className="px-4 py-3 text-center text-blue-800">{fmt(data.total_qty)}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{fmt(data.order_count)}</td>
                  <td className="px-4 py-3 text-center text-gray-400">{fmt(data.rows.reduce((n, r) => n + r.all_time_qty, 0))}</td>
                </tr>
              </tfoot>
            </table>
            {data.estimated_orders > 0 && <p className="text-xs text-amber-700 px-4 py-2">{fmt(data.estimated_orders)} أوردر بلا تاريخ صرف مسجّل — شهره تقديري (شهر إنشاء الأوردر).</p>}
          </div>
        )
      )}
    </div>
  );
}

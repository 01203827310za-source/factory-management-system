import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { salesApi } from '../../services/api';
import { statusLabel, RESERVED_STATUS } from '../../utils/orderStatus';
import MonthlyModelSales from '../MonthlyModelSales';
import { Empty, ErrorBox, ExportButton, Loading, Pager, Panel, SortTh, Th, dayOf, exportRows, fmt, inputCls, monthOf } from './reportKit';

type SaleRow = Awaited<ReturnType<typeof salesApi.getAll>>[number];
const STATUSES = ['تم الصرف', 'لم يتم الصرف', 'حساب عميل', RESERVED_STATUS, 'تم الإلغاء'];
const PAGE = 25;

const lines = (s: SaleRow) => ([
  [s.model1_code, s.model1_qty, s.model1_color], [s.model2_code, s.model2_qty, s.model2_color], [s.model3_code, s.model3_qty, s.model3_color],
  [s.model4_code, s.model4_qty, s.model4_color], [s.model5_code, s.model5_qty, s.model5_color],
] as [string, number, string][]).filter(([c, q]) => c && q > 0);
const pieces = (s: SaleRow) => lines(s).reduce((n, [, q]) => n + q, 0);

type SortKey = 'created_at' | 'order_number' | 'invoice_value' | 'order_status';

/** Sales reports: orders by date range / status / model, monthly comparison and a searchable order list — all from the existing /sales data. */
export default function SalesReportsTab() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSales(await salesApi.getAll()); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل المبيعات'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // date + search filters apply to every table; the status filter applies to the order list and the by-model table
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter(s => (!from || dayOf(s.created_at) >= from) && (!to || dayOf(s.created_at) <= to)
      && (!q || `${s.order_number} ${s.client} ${s.marketer} ${lines(s).map(l => l[0]).join(' ')}`.toLowerCase().includes(q)));
  }, [sales, from, to, search]);
  const rows = useMemo(() => base.filter(s => !status || s.order_status === status), [base, status]);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const r = sortKey === 'invoice_value' ? a.invoice_value - b.invoice_value
        : sortKey === 'order_number' ? a.order_number.localeCompare(b.order_number, 'ar', { numeric: true })
        : sortKey === 'order_status' ? a.order_status.localeCompare(b.order_status, 'ar')
        : a.created_at.localeCompare(b.created_at);
      return desc ? -r : r;
    });
    return list;
  }, [rows, sortKey, desc]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const paged = sorted.slice((page - 1) * PAGE, page * PAGE);
  useEffect(() => { setPage(1); }, [from, to, status, search]);

  const byStatus = useMemo(() => STATUSES.map(s => {
    const list = base.filter(x => x.order_status === s);
    return { status: s, count: list.length, value: list.reduce((n, x) => n + x.invoice_value, 0), pieces: list.reduce((n, x) => n + pieces(x), 0) };
  }), [base]);

  const byModel = useMemo(() => {
    const m = new Map<string, { qty: number; orders: Set<number>; value: number }>();
    rows.forEach(s => lines(s).forEach(([code, qty]) => {
      const k = code.trim();
      const e = m.get(k) ?? { qty: 0, orders: new Set<number>(), value: 0 };
      e.qty += qty; e.orders.add(s.id); m.set(k, e);
    }));
    return [...m.entries()].map(([code, e]) => ({ code, qty: e.qty, orders: e.orders.size })).sort((a, b) => b.qty - a.qty);
  }, [rows]);

  const byMonth = useMemo(() => {
    const m = new Map<string, { orders: number; value: number; pieces: number }>();
    rows.forEach(s => {
      const k = monthOf(s.created_at);
      const e = m.get(k) ?? { orders: 0, value: 0, pieces: 0 };
      e.orders += 1; e.value += s.invoice_value; e.pieces += pieces(s); m.set(k, e);
    });
    const list = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, e]) => ({ month, ...e }));
    return list.map((r, i) => ({ ...r, change: i > 0 && list[i - 1].value > 0 ? ((r.value - list[i - 1].value) / list[i - 1].value) * 100 : null })).reverse();
  }, [rows]);

  const toggle = (k: SortKey) => { if (sortKey === k) setDesc(!desc); else { setSortKey(k); setDesc(true); } };
  const exportOrders = () => exportRows('تقرير_المبيعات', 'الأوردرات', sorted.map(s => ({
    'رقم الأوردر': s.order_number, 'العميل': s.client, 'المسوق': s.marketer, 'تاريخ الأوردر': dayOf(s.created_at), 'الحالة': statusLabel(s.order_status),
    'الموديلات': lines(s).map(([c, q, col]) => `${c}${col ? ` (${col})` : ''} × ${q}`).join('، '), 'عدد القطع': pieces(s),
    'قيمة الفاتورة': s.invoice_value, 'العربون': s.deposit_paid, 'المتبقي': s.remaining, 'المحصّل من شركة الشحن': s.shipping_collected,
    'تاريخ الصرف': s.shipping_collected_date ?? '',
  })));

  return (
    <div className="space-y-5">
      <Panel title="مرشحات تقارير المبيعات" hint="التاريخ هنا تاريخ إنشاء الأوردر. للمبيعات حسب تاريخ الصرف استخدم جدول «المبيعات الشهرية حسب الموديل» أدناه.">
        <div className="p-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500">من<input type="date" className={`${inputCls} block`} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-gray-500">إلى<input type="date" className={`${inputCls} block`} value={to} onChange={e => setTo(e.target.value)} /></label>
          <label className="text-xs text-gray-500">الحالة
            <select className={`${inputCls} block`} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">كل الحالات</option>
              {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute right-2.5 top-2.5 text-gray-400" />
            <input className={`${inputCls} w-full pr-8`} placeholder="بحث برقم الأوردر أو العميل أو المسوق أو كود الموديل" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="border rounded-lg px-3 py-1.5 text-xs" onClick={() => { setFrom(''); setTo(''); setStatus(''); setSearch(''); }}>مسح المرشحات</button>
        </div>
      </Panel>

      {loading && <Loading />}
      {!loading && error && <ErrorBox message={error} onRetry={load} />}
      {!loading && !error && (
        <>
          <Panel title="الأوردرات حسب الحالة" hint="اضغط على صف لتصفية قائمة الأوردرات بحالته">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-gray-50 text-gray-600"><tr><Th>الحالة</Th><Th align="center">عدد الأوردرات</Th><Th align="center">قيمة الفواتير</Th><Th align="center">القطع</Th></tr></thead>
                <tbody>
                  {byStatus.map(r => (
                    <tr key={r.status} onClick={() => setStatus(status === r.status ? '' : r.status)} className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50 ${status === r.status ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-2 font-medium">{statusLabel(r.status)}</td>
                      <td className="px-3 py-2 text-center">{fmt(r.count)}</td>
                      <td className="px-3 py-2 text-center">{fmt(r.value)}</td>
                      <td className="px-3 py-2 text-center">{fmt(r.pieces)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 bg-gray-50 font-bold"><td className="px-3 py-2">الإجمالي</td><td className="px-3 py-2 text-center">{fmt(base.length)}</td><td className="px-3 py-2 text-center">{fmt(byStatus.reduce((n, r) => n + r.value, 0))}</td><td className="px-3 py-2 text-center">{fmt(byStatus.reduce((n, r) => n + r.pieces, 0))}</td></tr></tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400 px-4 py-2">قيمة الفاتورة ليست كاشًا — الكاش الفعلي يظهر في تبويب «التقارير المالية». الأوردرات الملغاة والمحجوزة تظهر هنا كحالات منفصلة ولا تُعدّ مبيعات مصروفة.</p>
          </Panel>

          <MonthlyModelSales />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Panel title="القطع حسب الموديل" hint={`الأوردرات المعروضة حاليًا بالمرشحات (${fmt(rows.length)} أوردر)`}
              actions={<ExportButton disabled={!byModel.length} onClick={() => exportRows('المبيعات_حسب_الموديل', 'الموديلات', byModel.map(r => ({ 'كود الموديل': r.code, 'القطع': r.qty, 'عدد الأوردرات': r.orders })))} />}>
              {byModel.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600 sticky top-0"><tr><Th>الموديل</Th><Th align="center">القطع</Th><Th align="center">الأوردرات</Th></tr></thead>
                    <tbody>{byModel.map(r => <tr key={r.code} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{r.code}</td><td className="px-3 py-2 text-center font-bold text-blue-700">{fmt(r.qty)}</td><td className="px-3 py-2 text-center text-gray-500">{fmt(r.orders)}</td></tr>)}</tbody>
                    <tfoot><tr className="border-t-2 bg-gray-50 font-bold"><td className="px-3 py-2">الإجمالي</td><td className="px-3 py-2 text-center">{fmt(byModel.reduce((n, r) => n + r.qty, 0))}</td><td /></tr></tfoot>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title="مقارنة شهرية" hint="حسب شهر إنشاء الأوردر، للأوردرات المعروضة بالمرشحات"
              actions={<ExportButton disabled={!byMonth.length} onClick={() => exportRows('مقارنة_المبيعات_الشهرية', 'الشهور', byMonth.map(r => ({ 'الشهر': r.month, 'الأوردرات': r.orders, 'القطع': r.pieces, 'قيمة الفواتير': r.value, 'التغيير عن الشهر السابق %': r.change === null ? '' : Math.round(r.change * 10) / 10 })))} />}>
              {byMonth.length === 0 ? <Empty /> : (
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600 sticky top-0"><tr><Th>الشهر</Th><Th align="center">الأوردرات</Th><Th align="center">القطع</Th><Th align="center">القيمة</Th><Th align="center">التغيير</Th></tr></thead>
                    <tbody>{byMonth.map(r => (
                      <tr key={r.month} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium">{r.month}</td><td className="px-3 py-2 text-center">{fmt(r.orders)}</td><td className="px-3 py-2 text-center">{fmt(r.pieces)}</td><td className="px-3 py-2 text-center">{fmt(r.value)}</td>
                        <td className={`px-3 py-2 text-center text-xs ${r.change === null ? 'text-gray-300' : r.change >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{r.change === null ? '—' : `${r.change >= 0 ? '+' : ''}${fmt(Math.round(r.change * 10) / 10)}%`}</td>
                      </tr>))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title="تفاصيل الأوردرات" hint={`${fmt(rows.length)} أوردر • إجمالي القيمة ${fmt(rows.reduce((n, s) => n + s.invoice_value, 0))} ج.م • ${fmt(rows.reduce((n, s) => n + pieces(s), 0))} قطعة`}
            actions={<ExportButton disabled={!rows.length} onClick={exportOrders} />}>
            {rows.length === 0 ? <Empty text="لا توجد أوردرات مطابقة للمرشحات" /> : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[760px]">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <SortTh label="رقم الأوردر" active={sortKey === 'order_number'} desc={desc} onClick={() => toggle('order_number')} />
                        <Th>العميل</Th>
                        <SortTh label="التاريخ" active={sortKey === 'created_at'} desc={desc} onClick={() => toggle('created_at')} />
                        <SortTh label="الحالة" active={sortKey === 'order_status'} desc={desc} onClick={() => toggle('order_status')} />
                        <Th>الموديلات</Th>
                        <SortTh label="القيمة" active={sortKey === 'invoice_value'} desc={desc} onClick={() => toggle('invoice_value')} align="center" />
                        <Th align="center">المتبقي</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map(s => (
                        <tr key={s.id} className="border-t border-gray-100 align-top">
                          <td className="px-3 py-2 font-medium">{s.order_number}</td>
                          <td className="px-3 py-2 text-gray-600">{s.client}<span className="block text-xs text-gray-400">{s.marketer}</span></td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{dayOf(s.created_at)}</td>
                          <td className="px-3 py-2">{statusLabel(s.order_status)}</td>
                          <td className="px-3 py-2 text-xs text-gray-600">{lines(s).map(([c, q, col]) => `${c}${col ? ` (${col})` : ''} × ${q}`).join('، ') || '—'}</td>
                          <td className="px-3 py-2 text-center font-semibold">{fmt(s.invoice_value)}</td>
                          <td className="px-3 py-2 text-center text-gray-500">{fmt(s.remaining)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pages={pages} onPage={setPage} />
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

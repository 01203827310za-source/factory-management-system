import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { salesApi } from '../../services/api';
import { statusLabel } from '../../utils/orderStatus';
import { daysBetween, outstandingCollection } from '../../utils/collections';
import { Empty, ErrorBox, ExportButton, Loading, Pager, Panel, SortTh, Th, Tile, dayOf, exportRows, fmt, inputCls, todayCairo } from './reportKit';

type SaleRow = Awaited<ReturnType<typeof salesApi.getAll>>[number];
const PAGE = 25;

const outstanding = outstandingCollection;
const daysSince = (iso: string) => daysBetween(iso, todayCairo());

type SortKey = 'days' | 'outstanding' | 'order_number' | 'created_at';

/** Orders whose payout / collection from the shipping company has not (fully) been received. Days = days since the order date. */
export default function DelayedCollectionsTab({ dashboardReceivable }: { dashboardReceivable?: number }) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [minDays, setMinDays] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [desc, setDesc] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSales(await salesApi.getAll()); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل الأوردرات'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = useMemo(() => sales.filter(s => outstanding(s) > 0.005), [sales]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const md = minDays === '' ? 0 : Math.max(0, parseInt(minDays, 10) || 0);
    return open.filter(s => (!from || dayOf(s.created_at) >= from) && (!to || dayOf(s.created_at) <= to) && (!status || s.order_status === status)
      && daysSince(s.created_at) >= md && (!q || `${s.order_number} ${s.client} ${s.shipping_number}`.toLowerCase().includes(q)));
  }, [open, from, to, status, minDays, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const r = sortKey === 'outstanding' ? outstanding(a) - outstanding(b)
        : sortKey === 'order_number' ? a.order_number.localeCompare(b.order_number, 'ar', { numeric: true })
        : sortKey === 'created_at' ? a.created_at.localeCompare(b.created_at)
        : daysSince(a.created_at) - daysSince(b.created_at);
      return desc ? -r : r;
    });
    return list;
  }, [filtered, sortKey, desc]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const paged = sorted.slice((page - 1) * PAGE, page * PAGE);
  useEffect(() => { setPage(1); }, [from, to, status, minDays, search]);

  const total = filtered.reduce((n, s) => n + outstanding(s), 0);
  const allTotal = open.reduce((n, s) => n + outstanding(s), 0);
  const aged = (min: number, max: number) => open.filter(s => { const d = daysSince(s.created_at); return d >= min && d <= max; }).reduce((n, s) => n + outstanding(s), 0);
  const toggle = (k: SortKey) => { if (sortKey === k) setDesc(!desc); else { setSortKey(k); setDesc(true); } };

  const exportAll = () => exportRows('التحصيلات_المتأخرة', 'التحصيلات', sorted.map(s => ({
    'رقم الأوردر': s.order_number, 'العميل': s.client, 'رقم الشحنة': s.shipping_number, 'تاريخ الأوردر': dayOf(s.created_at), 'الحالة': statusLabel(s.order_status),
    'قيمة الفاتورة': s.invoice_value, 'العربون': s.deposit_paid, 'المحصّل من شركة الشحن': s.shipping_collected, 'المبلغ المستحق': outstanding(s),
    'تاريخ الصرف المسجّل': s.shipping_collected_date ?? '', 'عدد الأيام منذ الأوردر': daysSince(s.created_at),
  })));

  return (
    <div className="space-y-5">
      <Panel title="التحصيلات المتأخرة" hint="أوردرات «لم يتم الصرف» (لم تُحصَّل) وأوردرات «تم الصرف» التي حصّلت شركة الشحن عنها أقل من المستحق. عدد الأيام محسوب من تاريخ إنشاء الأوردر.">
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile label="إجمالي المستحق على شركات الشحن" value={`${fmt(allTotal)} ج.م`} tone="amber" />
          <Tile label="أقل من 8 أيام" value={`${fmt(aged(0, 7))} ج.م`} />
          <Tile label="من 8 إلى 30 يومًا" value={`${fmt(aged(8, 30))} ج.م`} />
          <Tile label="أكثر من 30 يومًا" value={`${fmt(aged(31, 100000))} ج.م`} tone="red" />
        </div>
        {dashboardReceivable !== undefined && Math.abs(dashboardReceivable - allTotal) > 0.01 && (
          <p className="text-xs text-amber-700 px-4 pb-3">الرقم في لوحة التحكم («مستحق عند شركة الشحن») = {fmt(dashboardReceivable)} ج.م ويختلف عن مجموع هذه القائمة — راجع «تدقيق الأوردرات لم يتم الصرف».</p>
        )}
        <div className="px-4 pb-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500">من تاريخ الأوردر<input type="date" className={`${inputCls} block`} value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-gray-500">إلى<input type="date" className={`${inputCls} block`} value={to} onChange={e => setTo(e.target.value)} /></label>
          <label className="text-xs text-gray-500">الحالة
            <select className={`${inputCls} block`} value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">الكل</option><option value="لم يتم الصرف">لم يتم الصرف</option><option value="تم الصرف">تم الصرف (تحصيل ناقص)</option>
            </select>
          </label>
          <label className="text-xs text-gray-500">متأخر أكثر من (يوم)<input type="number" min={0} className={`${inputCls} block w-28`} value={minDays} onChange={e => setMinDays(e.target.value)} /></label>
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute right-2.5 top-2.5 text-gray-400" />
            <input className={`${inputCls} w-full pr-8`} placeholder="رقم الأوردر أو العميل أو الشحنة" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className="border rounded-lg px-3 py-1.5 text-xs" onClick={() => { setFrom(''); setTo(''); setStatus(''); setMinDays(''); setSearch(''); }}>مسح</button>
          <ExportButton disabled={!sorted.length} onClick={exportAll} />
        </div>
      </Panel>

      {loading && <Loading />}
      {!loading && error && <ErrorBox message={error} onRetry={load} />}
      {!loading && !error && (
        <Panel title={`${fmt(filtered.length)} أوردر • المستحق ${fmt(total)} ج.م`}>
          {sorted.length === 0 ? <Empty text="لا توجد تحصيلات متأخرة مطابقة" /> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <SortTh label="رقم الأوردر" active={sortKey === 'order_number'} desc={desc} onClick={() => toggle('order_number')} />
                      <Th>العميل</Th>
                      <SortTh label="تاريخ الأوردر" active={sortKey === 'created_at'} desc={desc} onClick={() => toggle('created_at')} />
                      <Th>الحالة</Th>
                      <Th align="center">قيمة الفاتورة</Th>
                      <Th align="center">المحصّل</Th>
                      <SortTh label="المستحق" active={sortKey === 'outstanding'} desc={desc} onClick={() => toggle('outstanding')} align="center" />
                      <Th>تاريخ الصرف المسجّل</Th>
                      <SortTh label="الأيام" active={sortKey === 'days'} desc={desc} onClick={() => toggle('days')} align="center" />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(s => {
                      const d = daysSince(s.created_at);
                      return (
                        <tr key={s.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-medium">{s.order_number}{s.shipping_number && <span className="block text-xs text-gray-400">شحنة {s.shipping_number}</span>}</td>
                          <td className="px-3 py-2 text-gray-600">{s.client}</td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{dayOf(s.created_at)}</td>
                          <td className="px-3 py-2">{statusLabel(s.order_status)}</td>
                          <td className="px-3 py-2 text-center">{fmt(s.invoice_value)}</td>
                          <td className="px-3 py-2 text-center text-gray-500">{fmt(s.shipping_collected)}</td>
                          <td className="px-3 py-2 text-center font-bold text-amber-700">{fmt(outstanding(s))}</td>
                          <td className="px-3 py-2 text-gray-500">{s.shipping_collected_date || '—'}</td>
                          <td className={`px-3 py-2 text-center font-semibold ${d > 30 ? 'text-red-700' : d > 7 ? 'text-amber-700' : 'text-gray-600'}`}>{fmt(d)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className="border-t-2 bg-gray-50 font-bold"><td className="px-3 py-2" colSpan={6}>إجمالي المستحق (حسب المرشحات)</td><td className="px-3 py-2 text-center text-amber-800">{fmt(total)}</td><td colSpan={2} /></tr></tfoot>
                </table>
              </div>
              <Pager page={page} pages={pages} onPage={setPage} />
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

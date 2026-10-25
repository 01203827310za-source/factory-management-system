import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { DashboardMetrics } from '../../types';
import MissingStockSummary from '../MissingStockSummary';
import { Empty, ExportButton, Pager, Panel, SortTh, Th, Tile, exportRows, fmt, inputCls } from './reportKit';

const PAGE = 25;
type SortKey = 'model_code' | 'actual_qty' | 'reserved_qty' | 'available_qty';

/**
 * Inventory & materials, from the numbers the Dashboard already computes (no new stock logic):
 *   physical = available + reserved; reserved is never counted as available; shortages are not stock.
 * The low-stock threshold is a display filter chosen here, not a business rule.
 */
export default function InventoryReportsTab({ metrics }: { metrics: DashboardMetrics }) {
  const [search, setSearch] = useState('');
  const [threshold, setThreshold] = useState('10');
  const [onlyLow, setOnlyLow] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('available_qty');
  const [desc, setDesc] = useState(false);
  const [page, setPage] = useState(1);

  const limit = Math.max(0, parseInt(threshold, 10) || 0);
  const items = metrics.stock_items;
  const totals = useMemo(() => ({
    actual: items.reduce((n, i) => n + i.actual_qty, 0),
    reserved: items.reduce((n, i) => n + i.reserved_qty, 0),
    available: items.reduce((n, i) => n + i.available_qty, 0),
    pending: items.reduce((n, i) => n + (i.pending_qty ?? 0), 0),
    low: items.filter(i => i.available_qty <= limit).length,
  }), [items, limit]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = items.filter(i => (!onlyLow || i.available_qty <= limit) && (!q || `${i.model_code} ${i.product_name} ${i.color}`.toLowerCase().includes(q)));
    list.sort((a, b) => {
      const r = sortKey === 'model_code' ? a.model_code.localeCompare(b.model_code, 'ar', { numeric: true }) : a[sortKey] - b[sortKey];
      return desc ? -r : r;
    });
    return list;
  }, [items, search, onlyLow, limit, sortKey, desc]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const paged = rows.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE);
  const toggle = (k: SortKey) => { if (sortKey === k) setDesc(!desc); else { setSortKey(k); setDesc(k !== 'available_qty'); } setPage(1); };

  const exportStock = () => exportRows('المخزون_الجاهز', 'المخزون', rows.map(i => ({
    'كود الموديل': i.model_code, 'اسم المنتج': i.product_name, 'اللون': i.color, 'الفعلي': i.actual_qty, 'المحجوز': i.reserved_qty, 'المتاح': i.available_qty,
    'ناقص (مطلوب للتجهيز)': i.pending_qty ?? 0, 'تكلفة الوحدة': i.unit_cost, 'القيمة': i.total,
  })));

  return (
    <div className="space-y-5">
      <Panel title="المخزون الجاهز" hint="الفعلي = المتاح + المحجوز. المحجوز لأوردرات «يتم التجهيز» لا يُعدّ متاحًا للبيع، والكميات الناقصة غير موجودة في المخزون.">
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-2">
          <Tile label="الفعلي" value={fmt(totals.actual)} tone="blue" />
          <Tile label="المحجوز" value={fmt(totals.reserved)} tone="amber" />
          <Tile label="المتاح للبيع" value={fmt(totals.available)} tone="green" />
          <Tile label="ناقص لأوردرات التجهيز" value={fmt(totals.pending)} tone="red" />
          <Tile label={`أصناف متاحها ≤ ${fmt(limit)}`} value={fmt(totals.low)} tone={totals.low ? 'red' : 'gray'} />
        </div>
        <div className="px-4 pb-4 flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute right-2.5 top-2.5 text-gray-400" />
            <input className={`${inputCls} w-full pr-8`} placeholder="بحث بكود الموديل أو الاسم أو اللون" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <label className="text-xs text-gray-500">حد التنبيه (متاح ≤)<input type="number" min={0} className={`${inputCls} block w-24`} value={threshold} onChange={e => setThreshold(e.target.value)} /></label>
          <label className="text-sm text-gray-600 flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={onlyLow} onChange={e => { setOnlyLow(e.target.checked); setPage(1); }} /> المنخفض فقط</label>
          <ExportButton disabled={!rows.length} onClick={exportStock} />
        </div>
        {rows.length === 0 ? <Empty /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <SortTh label="الموديل" active={sortKey === 'model_code'} desc={desc} onClick={() => toggle('model_code')} />
                    <Th>الاسم</Th><Th>اللون</Th>
                    <SortTh label="الفعلي" active={sortKey === 'actual_qty'} desc={desc} onClick={() => toggle('actual_qty')} align="center" />
                    <SortTh label="المحجوز" active={sortKey === 'reserved_qty'} desc={desc} onClick={() => toggle('reserved_qty')} align="center" />
                    <SortTh label="المتاح" active={sortKey === 'available_qty'} desc={desc} onClick={() => toggle('available_qty')} align="center" />
                    <Th align="center">ناقص</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((i, idx) => (
                    <tr key={`${i.model_code}-${i.color}-${idx}`} className={`border-t border-gray-100 ${i.available_qty <= limit ? 'bg-red-50/40' : ''}`}>
                      <td className="px-3 py-2 font-medium">{i.model_code}</td>
                      <td className="px-3 py-2 text-gray-600">{i.product_name}</td>
                      <td className="px-3 py-2 text-gray-600">{i.color || '—'}</td>
                      <td className="px-3 py-2 text-center">{fmt(i.actual_qty)}</td>
                      <td className="px-3 py-2 text-center text-amber-700">{fmt(i.reserved_qty)}</td>
                      <td className={`px-3 py-2 text-center font-bold ${i.available_qty <= limit ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(i.available_qty)}</td>
                      <td className="px-3 py-2 text-center text-red-600">{(i.pending_qty ?? 0) > 0 ? fmt(i.pending_qty ?? 0) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={Math.min(page, pages)} pages={pages} onPage={setPage} />
          </>
        )}
      </Panel>

      {metrics.missing_stock && metrics.missing_stock.rows.length > 0
        ? <MissingStockSummary summary={metrics.missing_stock} />
        : <Panel title="نواقص الموديلات"><Empty text="لا توجد نواقص: كل أوردرات «يتم التجهيز» مغطاة بالمخزون" /></Panel>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Panel title="الأقمشة" hint={`الكمية المتاحة = الوارد − المستهلك في القص — القيمة ${fmt(metrics.fabric_value)} ج.م`}
          actions={<ExportButton disabled={!metrics.fabric_items.length} onClick={() => exportRows('أرصدة_الأقمشة', 'الأقمشة', metrics.fabric_items.map(f => ({ 'الخامة': f.material_type, 'اللون': f.color, 'المتاح': f.available_qty, 'تكلفة الوحدة': f.unit_cost, 'القيمة': f.total })))} />}>
          {metrics.fabric_items.length === 0 ? <Empty text="لا توجد أرصدة أقمشة" /> : (
            <div className="overflow-x-auto max-h-80"><table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 sticky top-0"><tr><Th>الخامة</Th><Th>اللون</Th><Th align="center">المتاح</Th><Th align="center">القيمة</Th></tr></thead>
              <tbody>{metrics.fabric_items.map((f, i) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{f.material_type}</td><td className="px-3 py-2 text-gray-600">{f.color || '—'}</td><td className={`px-3 py-2 text-center ${f.available_qty <= 0 ? 'text-red-700 font-bold' : ''}`}>{fmt(f.available_qty)}</td><td className="px-3 py-2 text-center">{fmt(f.total)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Panel>
        <Panel title="الإكسسوارات" hint={`القيمة ${fmt(metrics.accessories_value)} ج.م`}
          actions={<ExportButton disabled={!metrics.accessories_items.length} onClick={() => exportRows('أرصدة_الإكسسوارات', 'الإكسسوارات', metrics.accessories_items.map(a => ({ 'الصنف': a.item_name, 'الكمية': a.qty, 'تكلفة الوحدة': a.unit_cost, 'القيمة': a.total })))} />}>
          {metrics.accessories_items.length === 0 ? <Empty text="لا توجد أرصدة إكسسوارات" /> : (
            <div className="overflow-x-auto max-h-80"><table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 sticky top-0"><tr><Th>الصنف</Th><Th align="center">الكمية</Th><Th align="center">القيمة</Th></tr></thead>
              <tbody>{metrics.accessories_items.map((a, i) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{a.item_name}</td><td className="px-3 py-2 text-center">{fmt(a.qty)}</td><td className="px-3 py-2 text-center">{fmt(a.total)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
    </div>
  );
}

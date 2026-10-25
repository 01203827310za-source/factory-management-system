import { useCallback, useEffect, useMemo, useState } from 'react';
import { modelProdApi, type ModelProdRecord } from '../../services/api';
import type { DashboardMetrics } from '../../types';
import { Empty, ErrorBox, ExportButton, Loading, Panel, Th, Tile, exportRows, fmt } from './reportKit';

/**
 * Cutting / production / preparation progress. Everything is read from existing records:
 *   cutting  → dashboard cutting_items (total / used / remaining pieces)
 *   models   → /model-prod (what was sent to production, what was received, wastage, status as recorded)
 *   orders   → dashboard pending_orders and missing_stock (orders «يتم التجهيز» short of stock)
 * Nothing is marked complete unless its own status says so.
 */
export default function ProductionTab({ metrics }: { metrics: DashboardMetrics }) {
  const [models, setModels] = useState<ModelProdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setModels(await modelProdApi.getAll()); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات التشغيل'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const byStatus = useMemo(() => {
    const m = new Map<string, { count: number; sent: number; received: number; wastage: number }>();
    models.forEach(r => {
      const e = m.get(r.status) ?? { count: 0, sent: 0, received: 0, wastage: 0 };
      e.count += 1; e.sent += r.qty_from_cutting; e.received += r.qty_received; e.wastage += r.wastage; m.set(r.status, e);
    });
    return [...m.entries()].map(([status, e]) => ({ status, ...e }));
  }, [models]);
  const inProgress = useMemo(() => models.filter(r => r.status === 'قيد التشغيل').sort((a, b) => a.date.localeCompare(b.date)), [models]);

  const cutting = metrics.cutting_items;
  const cutTotals = { total: cutting.reduce((n, c) => n + c.total_pieces, 0), used: cutting.reduce((n, c) => n + c.used_pieces, 0), remaining: cutting.reduce((n, c) => n + c.remaining_pieces, 0) };
  const pending = metrics.pending_orders ?? [];
  const shortages = metrics.missing_stock?.rows ?? [];

  return (
    <div className="space-y-5">
      <Panel title="أوردرات «يتم التجهيز»" hint="الأوردرات المقبولة التي ما زال بعضها بحاجة إلى إنتاج أو شراء — لا تُشحن حتى تتوفر الكمية فعليًا">
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile label="أوردرات التجهيز" value={fmt(metrics.reserved_orders_count ?? 0)} tone="amber" />
          <Tile label="منها ناقصة المخزون" value={fmt(pending.length)} tone={pending.length ? 'red' : 'green'} />
          <Tile label="إجمالي القطع الناقصة" value={fmt(metrics.pending_units ?? 0)} tone={metrics.pending_units ? 'red' : 'green'} />
          <Tile label="موديلات/ألوان تحتاج توريدًا" value={fmt(shortages.length)} tone={shortages.length ? 'red' : 'green'} />
        </div>
        {pending.length === 0 ? <Empty text="لا توجد أوردرات تجهيز ناقصة المخزون" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead className="bg-gray-50 text-gray-600"><tr><Th>الأوردر</Th><Th>العميل</Th><Th align="center">المطلوب</Th><Th align="center">محجوز</Th><Th align="center">ناقص</Th><Th>الأصناف الناقصة</Th></tr></thead>
              <tbody>{pending.map(o => (
                <tr key={o.sale_id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{o.order_number}</td><td className="px-3 py-2 text-gray-600">{o.client}</td>
                  <td className="px-3 py-2 text-center">{fmt(o.requested)}</td><td className="px-3 py-2 text-center text-amber-700">{fmt(o.reserved)}</td><td className="px-3 py-2 text-center font-bold text-red-700">{fmt(o.pending)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{o.slots.filter(x => x.pending > 0).map(x => `${x.code}${x.color ? ` (${x.color})` : ''}: ${x.pending}`).join('، ')}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="تقدّم القص" hint="القطع المقصوصة، المستخدم منها في التشغيل، والمتبقي — من سجل القص"
        actions={<ExportButton disabled={!cutting.length} onClick={() => exportRows('تقدم_القص', 'القص', cutting.map(c => ({ 'رقم القصة': c.cut_number, 'الوصف': c.cut_description || c.material_type, 'اللون': c.color, 'إجمالي القطع': c.total_pieces, 'المستخدم': c.used_pieces, 'المتبقي': c.remaining_pieces })))} />}>
        <div className="p-4 grid grid-cols-3 gap-2">
          <Tile label="إجمالي المقصوص" value={fmt(cutTotals.total)} /><Tile label="المستخدم في التشغيل" value={fmt(cutTotals.used)} tone="blue" /><Tile label="المتبقي من القص" value={fmt(cutTotals.remaining)} tone="amber" />
        </div>
        {cutting.length === 0 ? <Empty text="لا توجد أوامر قص" /> : (
          <div className="overflow-x-auto max-h-80"><table className="w-full text-sm min-w-[560px]">
            <thead className="bg-gray-50 text-gray-600 sticky top-0"><tr><Th>القصة</Th><Th>الوصف / الخامة</Th><Th>اللون</Th><Th align="center">الإجمالي</Th><Th align="center">المستخدم</Th><Th align="center">المتبقي</Th></tr></thead>
            <tbody>{cutting.map((c, i) => (
              <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{c.cut_number}</td><td className="px-3 py-2 text-gray-600">{c.cut_description || c.material_type}</td><td className="px-3 py-2 text-gray-600">{c.color || '—'}</td>
                <td className="px-3 py-2 text-center">{fmt(c.total_pieces)}</td><td className="px-3 py-2 text-center">{fmt(c.used_pieces)}</td><td className={`px-3 py-2 text-center font-semibold ${c.remaining_pieces > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{fmt(c.remaining_pieces)}</td></tr>))}
            </tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="تقدّم التشغيل (الموديلات)" hint="الحالة كما سُجّلت في سجل الإنتاج — لا يُفترض أي اكتمال غير مسجّل"
        actions={<ExportButton disabled={!models.length} onClick={() => exportRows('تقدم_التشغيل', 'التشغيل', models.map(r => ({ 'التاريخ': r.date, 'القصة': r.cut_number, 'الموديل': r.model_code, 'الوصف': r.model_description, 'اللون': r.color, 'الحالة': r.status, 'خرج من القص': r.qty_from_cutting, 'المستلم': r.qty_received, 'الهالك': r.wastage })))} />}>
        {loading && <Loading />}
        {!loading && error && <ErrorBox message={error} onRetry={load} />}
        {!loading && !error && (models.length === 0 ? <Empty text="لا توجد سجلات تشغيل" /> : (
          <>
            <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-2">
              {byStatus.map(s => <Tile key={s.status} label={`${s.status} (${fmt(s.count)} سجل)`} value={`أُرسل ${fmt(s.sent)} • مستلم ${fmt(s.received)} • هالك ${fmt(s.wastage)}`} tone={s.status === 'قيد التشغيل' ? 'amber' : 'gray'} />)}
            </div>
            <p className="text-xs font-semibold text-gray-700 px-4">قيد التشغيل الآن ({fmt(inProgress.length)})</p>
            {inProgress.length === 0 ? <Empty text="لا توجد سجلات قيد التشغيل" /> : (
              <div className="overflow-x-auto max-h-80"><table className="w-full text-sm min-w-[560px]">
                <thead className="bg-gray-50 text-gray-600 sticky top-0"><tr><Th>التاريخ</Th><Th>الموديل</Th><Th>اللون</Th><Th align="center">خرج من القص</Th><Th align="center">المستلم حتى الآن</Th><Th align="center">الهالك</Th></tr></thead>
                <tbody>{inProgress.map(r => (
                  <tr key={r.id} className="border-t border-gray-100"><td className="px-3 py-2 text-gray-500">{r.date}</td><td className="px-3 py-2 font-medium">{r.model_code}<span className="block text-xs text-gray-400">{r.model_description}</span></td><td className="px-3 py-2 text-gray-600">{r.color || '—'}</td>
                    <td className="px-3 py-2 text-center">{fmt(r.qty_from_cutting)}</td><td className="px-3 py-2 text-center">{fmt(r.qty_received)}</td><td className="px-3 py-2 text-center text-gray-500">{fmt(r.wastage)}</td></tr>))}
                </tbody>
              </table></div>
            )}
          </>
        ))}
      </Panel>

      <Panel title="موديلات تحتاج تعويضًا" hint="من ملخص النواقص: الكمية المطلوبة للتجهيز ناقصةً عن المخزون"
        actions={<ExportButton disabled={!shortages.length} onClick={() => exportRows('نواقص_التجهيز', 'النواقص', shortages.map(s => ({ 'الموديل': s.model_code, 'الاسم': s.model_name, 'اللون': s.color, 'المطلوب': s.required, 'المحجوز': s.reserved, 'الناقص': s.missing, 'كارت مخزون': s.has_card ? 'نعم' : 'لا' })))} />}>
        {shortages.length === 0 ? <Empty text="لا توجد نواقص" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
            <thead className="bg-gray-50 text-gray-600"><tr><Th>الموديل</Th><Th>اللون</Th><Th align="center">المطلوب</Th><Th align="center">المحجوز</Th><Th align="center">الناقص</Th></tr></thead>
            <tbody>{shortages.map((s, i) => (
              <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{s.model_code}<span className="block text-xs text-gray-400">{s.model_name}{s.has_card ? '' : ' — لا يوجد كارت مخزون'}</span></td><td className="px-3 py-2 text-gray-600">{s.color || '—'}</td>
                <td className="px-3 py-2 text-center">{fmt(s.required)}</td><td className="px-3 py-2 text-center text-amber-700">{fmt(s.reserved)}</td><td className="px-3 py-2 text-center font-bold text-red-700">{fmt(s.missing)}</td></tr>))}
            </tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}

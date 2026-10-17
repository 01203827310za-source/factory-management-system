import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import Modal from './Modal';
import { cashReportApi, type CashLine, type CashOrderReport, type CashReport } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';

const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }); } catch { return ''; } };

const Card = ({ title, value, hint, tone = 'gray' }: { title: string; value: string; hint?: string; tone?: 'gray' | 'green' | 'red' | 'blue' | 'amber' }) => {
  const tones = { gray: 'bg-gray-50 text-gray-800', green: 'bg-emerald-50 text-emerald-800', red: 'bg-red-50 text-red-800', blue: 'bg-blue-50 text-blue-800', amber: 'bg-amber-50 text-amber-800' };
  return (
    <div className={`rounded-lg p-3 ${tones[tone]}`}>
      <p className="text-xs opacity-70">{title}</p>
      <p className="font-bold text-base">{value}</p>
      {hint && <p className="text-[11px] opacity-70 mt-0.5">{hint}</p>}
    </div>
  );
};

export default function CashReconciliationModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const canRecord = can('expenses.create');
  const [data, setData] = useState<CashReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [orderView, setOrderView] = useState<CashOrderReport | null>(null);
  const [counted, setCounted] = useState('');
  const [countNote, setCountNote] = useState('');
  const [countDate, setCountDate] = useState('');
  const [adj, setAdj] = useState({ kind: 'adjustment' as 'opening' | 'adjustment', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState({ count: '', adj: '' });
  const newKeys = () => setKeys({ count: crypto.randomUUID(), adj: crypto.randomUUID() });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await cashReportApi.get(from || undefined, to || undefined)); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'تعذر تحميل تقرير الكاش'); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { if (isOpen) { newKeys(); load(); } }, [isOpen, load]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.lines ?? []).filter(l => (!category || l.category === category)
      && (!q || `${l.description} ${l.order_number} ${l.party} ${l.label} ${l.note}`.toLowerCase().includes(q)));
  }, [data, category, search]);

  const openOrder = async (l: CashLine) => {
    if (!l.order_id) return;
    try { setOrderView(await cashReportApi.getOrder(l.order_id)); } catch (e) { toast('error', e instanceof Error ? e.message : 'تعذر تحميل الأوردر'); }
  };

  const submitCount = async () => {
    const n = parseFloat(counted);
    if (!Number.isFinite(n) || n < 0) { toast('error', 'أدخل المبلغ المعدود فعليًا'); return; }
    setBusy(true);
    try {
      const r = await cashReportApi.recordCount({ counted_amount: n, count_date: countDate || undefined, note: countNote || undefined, idempotency_key: keys.count });
      toast('success', r.duplicate ? 'هذا الجرد مسجّل مسبقًا' : 'تم تسجيل الجرد');
      setCounted(''); setCountNote(''); newKeys(); await load();
    } catch (e) { toast('error', e instanceof Error ? e.message : 'خطأ في تسجيل الجرد'); } finally { setBusy(false); }
  };

  const submitAdjustment = async () => {
    const n = parseFloat(adj.amount);
    if (!Number.isFinite(n) || (adj.kind === 'adjustment' && n === 0)) { toast('error', 'أدخل مبلغًا صالحًا'); return; }
    if (adj.reason.trim().length < 3) { toast('error', 'سبب التسوية مطلوب'); return; }
    if (!window.confirm(adj.kind === 'opening' ? 'تسجيل الرصيد الافتتاحي لهذا الموسم؟ لا يمكن تعديله لاحقًا إلا بتسوية موثقة.' : 'تسجيل تسوية موثقة تغيّر الرصيد المحسوب؟ يبقى السجل الأصلي كما هو.')) return;
    setBusy(true);
    try {
      const r = await cashReportApi.recordAdjustment({ kind: adj.kind, amount: n, reason: adj.reason.trim(), idempotency_key: keys.adj });
      toast('success', r.duplicate ? 'هذه التسوية مسجّلة مسبقًا' : 'تم تسجيل التسوية');
      setAdj({ kind: 'adjustment', amount: '', reason: '' }); newKeys(); await load();
    } catch (e) { toast('error', e instanceof Error ? e.message : 'خطأ في تسجيل التسوية'); } finally { setBusy(false); }
  };

  const c = data?.cards;
  const r = data?.reconciliation;
  const lastCount = data?.counts[0];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تقرير مطابقة الكاش — تفاصيل «الصافي»" size="2xl">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">من<input type="date" className="block border rounded-lg px-2 py-1" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-gray-500">إلى<input type="date" className="block border rounded-lg px-2 py-1" value={to} onChange={e => setTo(e.target.value)} /></label>
          <button className="border rounded-lg px-3 py-1.5 text-xs" onClick={() => { setFrom(''); setTo(''); }}>كل الموسم</button>
          <button className="border rounded-lg px-3 py-1.5 text-xs flex items-center gap-1" onClick={load}><RefreshCw size={12} /> تحديث</button>
        </div>

        {loading && <div className="flex items-center justify-center py-10 text-gray-400"><RefreshCw size={18} className="animate-spin ml-2" /> جارٍ التحميل...</div>}
        {!loading && error && <p className="text-center py-8 text-gray-500">{error}</p>}

        {!loading && data && c && r && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card title="الرصيد الافتتاحي للفترة" value={`${fmt(c.opening_balance)} ج.م`} hint={c.recorded_opening_adjustment ? 'مسجّل يدويًا' : 'لم يُسجَّل رصيد افتتاحي — يبدأ من صفر'} />
              <Card title="إجمالي المقبوض فعليًا" value={`${fmt(c.total_in)} ج.م`} tone="green" />
              <Card title="إجمالي المدفوع فعليًا" value={`${fmt(c.total_out)} ج.م`} tone="red" />
              <Card title="صافي الحركة في الفترة" value={`${fmt(c.net_movement)} ج.م`} />
              <Card title="الرصيد الختامي المحسوب" value={`${fmt(c.closing_balance)} ج.م`} tone="blue" hint="= الافتتاحي + المقبوض − المدفوع" />
              <Card title="مستحق على شركات الشحن (ليس كاش)" value={`${fmt(c.shipping_receivable)} ج.م`} tone="amber" hint="لا يدخل الرصيد حتى يُحصَّل فعليًا" />
              <Card title="العربون / الردود" value={`${fmt(c.deposits_received)} / ${fmt(c.customer_refunds_paid)}`} hint={`عربون مستلم / رد فعلي للعملاء${c.deposits_reversed_on_cancel ? ` • عكس بسبب إلغاء ${fmt(c.deposits_reversed_on_cancel)}` : ''}`} />
              <Card title="غير مطابق / غير موثق" value={`${r.unverified_count.toLocaleString('ar-EG')} حركة • ${fmt(r.unverified_amount)}`} tone={r.discrepancy !== 0 || r.unverified_count ? 'amber' : 'green'} hint={`فرق عن الصافي في الداشبورد: ${fmt(r.discrepancy)}`} />
            </div>

            <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
              <p><strong>هذا الرقم هو الكاش فقط</strong> — ليس الربح ولا قيمة المخزون ولا مستحقات العملاء أو الموردين ولا الأوردرات المحجوزة.</p>
              <p>الصافي في لوحة التحكم = {fmt(r.dashboard_net)} ج.م وهو مجموع نفس المصادر أدناه (الفرق {fmt(r.discrepancy)}).</p>
              {r.reversals_not_paid_out > 0 && <p className="text-amber-700">قيود عكس بسبب الإلغاء بقيمة {fmt(r.reversals_not_paid_out)} ج.م خفّضت الرصيد المحسوب دون أن يُسجَّل دفع فعلي لأحد — إن كانت الفلوس ما زالت في الخزنة فهذا يفسّر زيادة الجرد الفعلي.</p>}
              {r.fabric_purchases_not_in_cash > 0 && <p className="text-amber-700">مشتريات أقمشة بقيمة {fmt(r.fabric_purchases_not_in_cash)} ج.م غير محسوبة كحركة كاش إلا إذا سُجّلت أيضًا كمصروف.</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              <select className="border rounded-lg px-2 py-1.5 text-xs" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">كل أنواع الحركات</option>
                {Object.entries(data.categories).filter(([k]) => k !== 'opening').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div className="relative flex-1 min-w-[160px]">
                <Search size={14} className="absolute right-2 top-2.5 text-gray-400" />
                <input className="w-full border rounded-lg pr-7 pl-2 py-1.5 text-xs" placeholder="بحث بالوصف أو رقم الأوردر أو العميل" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs min-w-[780px]">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-2 text-right">التاريخ</th><th className="px-2 py-2 text-right">النوع</th><th className="px-2 py-2 text-right">البيان</th>
                    <th className="px-2 py-2 text-center">وارد</th><th className="px-2 py-2 text-center">منصرف</th><th className="px-2 py-2 text-center">الرصيد</th><th className="px-2 py-2 text-right">المرجع</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-gray-400">لا توجد حركات</td></tr>}
                  {rows.map(l => (
                    <tr key={l.key} className="border-t border-gray-100 align-top">
                      <td className="px-2 py-2 whitespace-nowrap">{l.date}<br /><span className="text-gray-400">{fmtTime(l.time)}</span></td>
                      <td className="px-2 py-2">{l.label}{!l.verified && <span className="block text-amber-600">غير موثق</span>}</td>
                      <td className="px-2 py-2">
                        {l.order_id ? <button className="text-blue-700 hover:underline text-right" onClick={() => openOrder(l)}>{l.description}</button> : l.description}
                        {l.party && <span className="block text-gray-400">{l.party}</span>}
                        {l.note && <span className="block text-gray-400">{l.note}</span>}
                        {l.status && <span className="block text-gray-400">حالة الأوردر: {l.status}</span>}
                      </td>
                      <td className="px-2 py-2 text-center text-emerald-700 font-semibold">{l.in ? fmt(l.in) : ''}</td>
                      <td className="px-2 py-2 text-center text-red-700 font-semibold">{l.out ? fmt(l.out) : ''}</td>
                      <td className={`px-2 py-2 text-center font-bold ${l.balance < 0 ? 'text-red-700' : ''}`}>{fmt(l.balance)}</td>
                      <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{l.source.table} #{l.source.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {orderView && (
              <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <p className="font-semibold">أوردر {orderView.order.order_number} — {orderView.order.client} ({orderView.order.status})</p>
                  <button className="text-xs text-gray-500" onClick={() => setOrderView(null)}>إغلاق</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <Card title="قيمة الفاتورة (ليست كاش)" value={fmt(orderView.invoice_amount)} />
                  <Card title="عربون مستلم" value={fmt(orderView.deposit_received)} hint={orderView.deposit_reversed_on_cancel ? `عُكس بالإلغاء ${fmt(orderView.deposit_reversed_on_cancel)}` : undefined} />
                  <Card title="محصّل من شركة الشحن (إجمالي / صافي)" value={`${fmt(orderView.shipping_collected_gross)} / ${fmt(orderView.shipping_collected_net)}`} />
                  <Card title="مردود للعميل / لشركة الشحن" value={`${fmt(orderView.customer_refunded)} / ${fmt(orderView.shipping_repaid)}`} />
                  <Card title="المتبقي المستحق" value={fmt(orderView.remaining_due)} tone="amber" />
                  <Card title="دفعات إضافية / خصومات الشحن" value="غير مسجّلة" hint="النظام لا يربط الدفعات بالأوردر ولا يسجّل رسوم الشحن" />
                </div>
                {orderView.cancellations.map(x => (
                  <p key={x.id} className="text-xs text-gray-600">إلغاء بتاريخ {x.at.slice(0, 10)} بواسطة {x.by || '—'} (كان: {x.status_before}) — عُكس عربون {fmt(x.deposit_reversed)} وتحصيل {fmt(x.collected_reversed)}{x.reason ? ` — ${x.reason}` : ''}{x.reopened_at ? ' — أُعيد فتحه' : ''}</p>
                ))}
                <p className="text-[11px] text-gray-500">{orderView.note}</p>
              </div>
            )}

            <div className="border border-gray-200 rounded-lg p-3 space-y-2">
              <p className="font-semibold">مقارنة بالكاش الفعلي في الخزنة</p>
              {lastCount ? (
                <p className="text-xs text-gray-600">آخر جرد ({lastCount.count_date}) بواسطة {lastCount.created_by}: المعدود {fmt(lastCount.counted_amount)} • المحسوب وقتها {fmt(lastCount.calculated_amount)} • <strong className={lastCount.difference === 0 ? 'text-emerald-700' : 'text-red-700'}>الفرق {fmt(lastCount.difference)}</strong>{lastCount.note ? ` — ${lastCount.note}` : ''}</p>
              ) : <p className="text-xs text-gray-400">لم يُسجَّل أي جرد بعد.</p>}
              {canRecord && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input type="number" min={0} className="border rounded-lg px-2 py-1.5" placeholder="المبلغ المعدود فعليًا" value={counted} onChange={e => setCounted(e.target.value)} />
                  <input type="date" className="border rounded-lg px-2 py-1.5" value={countDate} onChange={e => setCountDate(e.target.value)} />
                  <input className="border rounded-lg px-2 py-1.5" placeholder="ملاحظة" value={countNote} onChange={e => setCountNote(e.target.value)} />
                  <button disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg py-1.5" onClick={submitCount}>تسجيل الجرد</button>
                  {counted !== '' && Number.isFinite(parseFloat(counted)) && <p className="sm:col-span-4 text-xs">الفرق عن المحسوب ({fmt(c.closing_balance)}): <strong>{fmt(parseFloat(counted) - c.closing_balance)}</strong> — لا يُعدَّل أي سجل تلقائيًا.</p>}
                </div>
              )}
              {data.counts.length > 1 && <details className="text-xs text-gray-500"><summary className="cursor-pointer">سجل الجرد</summary>{data.counts.map(k => <p key={k.id}>{k.count_date} — معدود {fmt(k.counted_amount)} / محسوب {fmt(k.calculated_amount)} / فرق {fmt(k.difference)} — {k.created_by}</p>)}</details>}
            </div>

            {canRecord && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                <p className="font-semibold">رصيد افتتاحي / تسوية موثقة</p>
                <p className="text-xs text-gray-500">لا يُعدَّل أي سجل قديم: كل تسوية سطر جديد بسبب واسم المستخدم. الرصيد الافتتاحي يُسجَّل مرة واحدة للموسم.</p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <select className="border rounded-lg px-2 py-1.5" value={adj.kind} onChange={e => setAdj({ ...adj, kind: e.target.value as 'opening' | 'adjustment' })}>
                    <option value="adjustment">تسوية (+ يزيد / − ينقص)</option>
                    <option value="opening">رصيد افتتاحي</option>
                  </select>
                  <input type="number" className="border rounded-lg px-2 py-1.5" placeholder="المبلغ" value={adj.amount} onChange={e => setAdj({ ...adj, amount: e.target.value })} />
                  <input className="border rounded-lg px-2 py-1.5" placeholder="السبب (مطلوب)" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} />
                  <button disabled={busy} className="bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white rounded-lg py-1.5" onClick={submitAdjustment}>تسجيل</button>
                </div>
              </div>
            )}

            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">ما الذي لا يغطيه هذا التقرير؟</summary>
              <ul className="list-disc pr-5 mt-1 space-y-0.5">{data.known_gaps.map(g => <li key={g}>{g}</li>)}</ul>
            </details>
          </>
        )}
      </div>
    </Modal>
  );
}

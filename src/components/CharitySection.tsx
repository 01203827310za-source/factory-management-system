import { useCallback, useEffect, useState } from 'react';
import { Heart, History, RefreshCw, Trash2, ChevronRight } from 'lucide-react';
import Modal from './Modal';
import { useToast } from './Toast';
import { useAuth } from '../contexts/AuthContext';
import { charityApi, type CharityHistoryRow, type CharityMonthSummary } from '../services/api';

const METHODS = ['نقدي', 'تحويل بنكي', 'شيك'];
const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const egp = (n: number) => `${fmt(n)} ج.م`;
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const currentMonth = () => todayStr().slice(0, 7);

const STATUS_STYLE: Record<CharityMonthSummary['status'], string> = {
  none_due: 'bg-gray-100 text-gray-600',
  unpaid: 'bg-red-100 text-red-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
};

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white/70 rounded-lg p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-base font-bold ${tone ?? 'text-gray-800'}`}>{value}</p>
    </div>
  );
}

export default function CharitySection({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const canPay = can('expenses.create');
  const canReverse = can('expenses.delete');

  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<CharityMonthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [payOpen, setPayOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await charityApi.getSummary(month)); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'تعذر تحميل صدقة الشهر'); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const afterChange = async () => { await load(); onChanged(); };

  return (
    <div className="bg-gradient-to-l from-pink-50 to-rose-50 border border-pink-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="text-lg font-bold text-rose-700 flex items-center gap-2">
          <Heart size={20} className="fill-rose-500 text-rose-500" /> صدقة الشهر ❤️
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500" htmlFor="charity-month">الشهر</label>
          <input
            id="charity-month" type="month" value={month} max={currentMonth()}
            onChange={e => e.target.value && setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
          />
          <button onClick={() => setHistoryOpen(true)} className="flex items-center gap-1 text-xs text-rose-700 border border-rose-200 bg-white hover:bg-rose-50 rounded-lg px-2.5 py-1.5">
            <History size={14} /> سجل الشهور
          </button>
        </div>
      </div>

      {loading && <div className="flex items-center justify-center py-6 text-gray-400 text-sm"><RefreshCw size={16} className="animate-spin ml-2" /> جارٍ التحميل...</div>}
      {!loading && (error || !data) && <p className="text-center py-6 text-sm text-gray-500">{error || 'لا توجد بيانات'}</p>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Field label="الشهر" value={data.label} />
            <Field label="المستلم فعليًا من شركة الشحن" value={egp(data.collections_total)} tone="text-blue-800" />
            <Field label="نسبة الصدقة المطبقة" value={`${fmt(data.rate_percent)}%`} />
            <Field label="الصدقة المستحقة" value={egp(data.due)} tone="text-rose-700" />
            <Field label="ما تم صرفه" value={egp(data.paid)} tone="text-emerald-700" />
            <Field label="المتبقي من الصدقة" value={egp(data.remaining)} tone={data.remaining > 0 ? 'text-red-700' : 'text-gray-800'} />
            <div className="bg-white/70 rounded-lg p-3">
              <p className="text-xs text-gray-500">حالة الصدقة</p>
              <span className={`inline-block mt-0.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_STYLE[data.status]}`}>{data.status_label}</span>
            </div>
            <div className="flex items-end">
              {canPay && (
                <button
                  onClick={() => setPayOpen(true)}
                  disabled={data.remaining <= 0}
                  className="w-full bg-rose-600 hover:bg-rose-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg py-2.5 text-sm font-semibold transition"
                >
                  صرف الصدقة
                </button>
              )}
            </div>
          </div>
          {data.estimated_count > 0 && (
            <p className="text-xs text-amber-700 mt-3">
              ملاحظة: {data.estimated_count.toLocaleString('ar-EG')} أوردر ({egp(data.estimated_total)}) تم صرفه قبل تسجيل تاريخ الاستلام، فتم احتسابه حسب تاريخ إنشاء الأوردر. يمكنك تحديد تاريخ الاستلام من تعديل الأوردر.
            </p>
          )}
          {data.overpaid > 0 && (
            <p className="text-xs text-red-600 mt-2">تنبيه: المصروف ({egp(data.paid)}) أكبر من المستحق الحالي بمقدار {egp(data.overpaid)} (تغيّر إجمالي التحصيل بعد الصرف).</p>
          )}
        </>
      )}

      {data && (
        <PayModal
          isOpen={payOpen} summary={data}
          onClose={() => setPayOpen(false)}
          onPaid={async () => { setPayOpen(false); await afterChange(); }}
          toast={toast}
        />
      )}
      <HistoryModal
        isOpen={historyOpen} onClose={() => setHistoryOpen(false)} canReverse={canReverse}
        onSelectMonth={m => { setMonth(m); setHistoryOpen(false); }}
        onChanged={afterChange} toast={toast} refreshKey={data ? `${data.paid}-${data.payment_count}` : ''}
      />
    </div>
  );
}

type Toast = ReturnType<typeof useToast>;

function PayModal({ isOpen, summary, onClose, onPaid, toast }: {
  isOpen: boolean; summary: CharityMonthSummary; onClose: () => void; onPaid: () => Promise<void>; toast: Toast;
}) {
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayStr());
  const [method, setMethod] = useState(METHODS[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // One key per open modal: a double-click / network retry re-sends the SAME key, so the
  // server returns the first payment instead of creating a second expense.
  const [key, setKey] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setAmount(summary.remaining); setDate(todayStr()); setMethod(METHODS[0]); setNotes(''); setSaving(false);
    setKey(crypto.randomUUID());
  }, [isOpen, summary.remaining]);

  const err = !(amount > 0) ? 'أدخل مبلغًا أكبر من صفر'
    : amount > summary.remaining + 0.005 ? `المبلغ أكبر من المتبقي (${egp(summary.remaining)})`
    : !date ? 'اختر تاريخ الصرف' : '';

  const submit = async () => {
    if (err || saving) return;
    setSaving(true);
    try {
      const r = await charityApi.pay({ charity_month: summary.month, amount, payment_date: date, payment_method: method, notes, idempotency_key: key });
      toast('success', r.duplicate ? 'تم تسجيل هذه الدفعة مسبقًا' : `تم صرف ${egp(amount)} وتسجيلها كمصروف`);
      await onPaid();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'خطأ في صرف الصدقة');
      setSaving(false);
    }
  };

  const ic = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300';
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="صرف الصدقة" size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">الشهر الذي تخصه الصدقة</p><p className="font-bold">{summary.label}</p></div>
          <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">الصدقة المستحقة</p><p className="font-bold text-rose-700">{egp(summary.due)}</p></div>
          <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">تم صرفه</p><p className="font-bold text-emerald-700">{egp(summary.paid)}</p></div>
          <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">المتبقي</p><p className="font-bold text-red-700">{egp(summary.remaining)}</p></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">المبلغ الذي سيتم صرفه</label>
          <input type="number" min={0} max={summary.remaining} step="0.01" className={ic} value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value) || 0)} />
          {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">تاريخ الصرف</label>
            <input type="date" className={ic} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">طريقة الصرف</label>
            <select className={ic} value={method} onChange={e => setMethod(e.target.value)}>
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ملاحظات (اختياري)</label>
          <textarea rows={2} className={ic} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <p className="text-xs text-gray-400">سيتم تسجيل المبلغ كمصروف حقيقي بتصنيف «صدقة» في صفحة المصاريف والإيرادات.</p>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 border border-gray-200 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          <button onClick={submit} disabled={!!err || saving} className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:bg-gray-300 text-white py-2 rounded-lg text-sm font-semibold">
            {saving ? 'جارٍ الحفظ...' : 'تأكيد صرف الصدقة'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HistoryModal({ isOpen, onClose, canReverse, onSelectMonth, onChanged, toast, refreshKey }: {
  isOpen: boolean; onClose: () => void; canReverse: boolean; onSelectMonth: (m: string) => void;
  onChanged: () => Promise<void>; toast: Toast; refreshKey: string;
}) {
  const [rows, setRows] = useState<CharityHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<CharityMonthSummary | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true); setError('');
    try { setRows((await charityApi.getHistory()).months); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل السجل'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isOpen) { setDetail(null); loadHistory(); } }, [isOpen, loadHistory, refreshKey]);

  const openMonth = async (m: string) => {
    try { setDetail(await charityApi.getSummary(m)); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'تعذر تحميل تفاصيل الشهر'); }
  };

  const reverse = async (id: number) => {
    if (!window.confirm('إلغاء دفعة الصدقة سيحذف المصروف المرتبط بها أيضًا. متابعة؟')) return;
    setBusyId(id);
    try {
      const r = await charityApi.reverse(id);
      setDetail(r.summary);
      toast('success', 'تم إلغاء الدفعة وحذف المصروف المرتبط');
      await loadHistory();
      await onChanged();
    } catch (e) { toast('error', e instanceof Error ? e.message : 'خطأ في الإلغاء'); }
    finally { setBusyId(null); }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={detail ? `صدقة ${detail.label}` : 'سجل صدقة الشهور'} size="2xl">
      {detail ? (
        <div className="space-y-3">
          <button onClick={() => setDetail(null)} className="flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 font-medium">
            <ChevronRight size={16} /> رجوع
          </button>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Field label="التحصيل الفعلي من الشحن" value={egp(detail.collections_total)} />
            <Field label={`المستحق (${fmt(detail.rate_percent)}%)`} value={egp(detail.due)} tone="text-rose-700" />
            <Field label="ما تم صرفه" value={egp(detail.paid)} tone="text-emerald-700" />
            <Field label="المتبقي" value={egp(detail.remaining)} tone="text-red-700" />
          </div>
          {detail.payments.length === 0 ? (
            <p className="text-center py-6 text-sm text-gray-400">لا توجد عمليات صرف لهذا الشهر</p>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-gray-600">
                  {['تاريخ الصرف', 'المبلغ', 'الطريقة', 'ملاحظات', 'المصروف المرتبط', 'بواسطة', ''].map(h => <th key={h} className="text-right px-3 py-2 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {detail.payments.map(p => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{p.payment_date}</td>
                      <td className="px-3 py-2 font-bold text-emerald-700 whitespace-nowrap">{egp(p.amount)}</td>
                      <td className="px-3 py-2 text-gray-600">{p.payment_method || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{p.notes || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{p.expense ? `#${p.expense.id} — ${p.expense.statement}` : '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{p.created_by || '—'}</td>
                      <td className="px-3 py-2">
                        {canReverse && (
                          <button onClick={() => reverse(p.id)} disabled={busyId === p.id} title="إلغاء الدفعة" className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => onSelectMonth(detail.month)} className="text-sm text-rose-700 hover:underline">عرض هذا الشهر في اللوحة</button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400 text-sm"><RefreshCw size={18} className="animate-spin ml-2" /> جارٍ التحميل...</div>
      ) : error ? (
        <p className="text-center py-8 text-sm text-gray-500">{error}</p>
      ) : rows.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">لا توجد بيانات</p>
      ) : (
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-600">
              {['الشهر', 'التحصيل الفعلي', 'النسبة', 'المستحق', 'المصروف', 'المتبقي', 'عدد العمليات', 'الحالة'].map(h => <th key={h} className="text-right px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.month} onClick={() => openMonth(r.month)} className="cursor-pointer hover:bg-rose-50/50">
                  <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{r.label}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{egp(r.collections_total)}</td>
                  <td className="px-3 py-2">{fmt(r.rate_percent)}%</td>
                  <td className="px-3 py-2 font-bold text-rose-700 whitespace-nowrap">{egp(r.due)}</td>
                  <td className="px-3 py-2 text-emerald-700 whitespace-nowrap">{egp(r.paid)}</td>
                  <td className="px-3 py-2 text-red-700 whitespace-nowrap">{egp(r.remaining)}</td>
                  <td className="px-3 py-2">{r.payment_count.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{r.status_label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

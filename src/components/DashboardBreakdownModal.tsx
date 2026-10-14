import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import Modal from './Modal';
import { statusLabel } from '../utils/orderStatus';
import {
  dashboardApi,
  type NetProfitBreakdown, type ExpensesBreakdown, type ExpenseCategoryRow, type ExpenseRecordsResult,
  type SalesBreakdown, type SalesGroupRow, type SalesRecordsResult,
} from '../services/api';

export type BreakdownKind = 'net_profit' | 'expenses' | 'sales';

const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const egp = (n: number) => `${fmt(n)} ج.م`;
const PAGE_SIZE = 10;

const TITLES: Record<BreakdownKind, string> = {
  net_profit: 'تفاصيل صافي الربح',
  expenses: 'تفاصيل إجمالي المصاريف',
  sales: 'تفاصيل إجمالي المبيعات',
};

function Loading() {
  return (
    <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
      <RefreshCw size={18} className="animate-spin ml-2" /> جارٍ تحميل التفاصيل...
    </div>
  );
}

function Empty({ text = 'لا توجد سجلات' }: { text?: string }) {
  return <div className="text-center py-8 text-gray-400 text-sm">{text}</div>;
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'green' | 'red' | 'blue' }) {
  const color = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : tone === 'blue' ? 'text-blue-800' : 'text-gray-800';
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${strong ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50'}`}>
      <span className={`text-sm ${strong ? 'font-semibold text-blue-800' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm font-bold ${strong ? 'text-base' : ''} ${color}`}>{value}</span>
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 pt-2">
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 disabled:opacity-40">
        <ChevronRight size={13} /> السابق
      </button>
      <span>صفحة {page} من {pages}</span>
      <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages} className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 disabled:opacity-40">
        التالي <ChevronLeft size={13} />
      </button>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 font-medium mb-3">
      <ChevronRight size={16} /> رجوع
    </button>
  );
}

/** Small hook: run an async loader whenever `deps` change, exposing loading / error state. */
function useLoader<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    load()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) { setData(null); setError(e?.message || 'تعذر تحميل التفاصيل'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, error };
}

// ---------- Net profit ----------
function NetProfitView() {
  const { data, loading, error } = useLoader<NetProfitBreakdown>(() => dashboardApi.getNetProfitBreakdown(), []);
  if (loading) return <Loading />;
  if (error || !data) return <Empty text={error || 'لا توجد بيانات'} />;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-emerald-700 mb-2">الوارد (الإيرادات)</h3>
        <div className="space-y-1.5">
          {data.inflows.map(l => <Row key={l.key} label={l.label} value={egp(l.amount)} tone="green" />)}
          <Row label="إجمالي الإيرادات" value={egp(data.total_revenue)} strong tone="green" />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-bold text-red-700 mb-2">الصادر (المصاريف)</h3>
        <div className="space-y-1.5">
          {data.outflows.map(l => <Row key={l.key} label={l.label} value={egp(l.amount)} tone="red" />)}
          <Row label="إجمالي المصاريف" value={egp(data.total_expenses)} strong tone="red" />
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
        <p><span className="font-semibold">طريقة الحساب:</span> {data.method}</p>
        <p><span className="font-semibold">تكلفة البضاعة المباعة:</span> {data.cogs_included ? 'مشمولة' : 'غير مشمولة'} — {data.cogs_note}</p>
      </div>
      <Row label="صافي الربح النهائي" value={egp(data.net_profit)} strong tone={data.net_profit >= 0 ? 'green' : 'red'} />
    </div>
  );
}

// ---------- Expenses ----------
function ExpensesView() {
  const { data, loading, error } = useLoader<ExpensesBreakdown>(() => dashboardApi.getExpensesBreakdown(), []);
  const [selected, setSelected] = useState<ExpenseCategoryRow | null>(null);

  if (selected && data) return <ExpenseRecordsView category={selected} onBack={() => setSelected(null)} />;
  if (loading) return <Loading />;
  if (error || !data) return <Empty text={error || 'لا توجد بيانات'} />;
  if (data.categories.length === 0) return <Empty text="لا توجد مصاريف في هذا الموسم" />;

  const canOpen = (c: ExpenseCategoryRow) =>
    c.kind === 'expense' ? data.record_access.expense : c.kind === 'debt_payment' ? data.record_access.debt_payment : data.record_access.refund;

  return (
    <div className="space-y-2">
      {data.categories.map(c => {
        const clickable = canOpen(c);
        return (
          <button
            key={c.key}
            disabled={!clickable}
            onClick={() => setSelected(c)}
            title={clickable ? 'عرض السجلات' : 'لا تملك صلاحية عرض السجلات'}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-blue-50 disabled:hover:bg-gray-50 disabled:cursor-default rounded-lg transition text-right"
          >
            <span className="text-sm text-gray-700 flex items-center gap-1.5">
              {c.label}
              <span className="text-xs text-gray-400">({c.count.toLocaleString('ar-EG')} عملية)</span>
              {clickable && <ChevronLeft size={14} className="text-gray-400" />}
            </span>
            <span className="text-sm font-bold text-red-700">{egp(c.total)}</span>
          </button>
        );
      })}
      <Row label="إجمالي المصاريف" value={egp(data.total_expenses)} strong tone="red" />
      {!data.reconciled && (
        <p className="text-xs text-red-600">تنبيه: مجموع التصنيفات ({egp(data.categories_total)}) لا يطابق الإجمالي — الفرق {egp(data.difference)}.</p>
      )}
    </div>
  );
}

function ExpenseRecordsView({ category, onBack }: { category: ExpenseCategoryRow; onBack: () => void }) {
  const { data, loading, error } = useLoader<ExpenseRecordsResult>(() => dashboardApi.getExpenseRecords(category.key), [category.key]);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil((data?.records.length ?? 0) / PAGE_SIZE));
  const rows = (data?.records ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <div>
      <BackButton onClick={onBack} />
      <h3 className="text-sm font-bold text-gray-800 mb-2">{category.label}</h3>
      {loading ? <Loading /> : error || !data ? <Empty text={error || 'لا توجد بيانات'} /> : data.records.length === 0 ? <Empty /> : (
        <>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="text-right px-3 py-2 font-semibold">التاريخ</th>
                  <th className="text-right px-3 py-2 font-semibold">الوصف</th>
                  <th className="text-right px-3 py-2 font-semibold">التصنيف</th>
                  <th className="text-right px-3 py-2 font-semibold">المرجع</th>
                  <th className="text-right px-3 py-2 font-semibold">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2 text-gray-800">{r.description || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.category}</td>
                    <td className="px-3 py-2 text-gray-600">{r.reference || '—'}</td>
                    <td className="px-3 py-2 font-bold text-red-700 whitespace-nowrap">{egp(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} onPage={setPage} />
          <div className="mt-3"><Row label={`إجمالي ${category.label}`} value={egp(data.total)} strong tone="red" /></div>
        </>
      )}
    </div>
  );
}

// ---------- Sales ----------
type SalesGroupKey = 'status' | 'marketer' | 'delivery_method';
const GROUP_LABELS: Record<SalesGroupKey, string> = { status: 'حالة الأوردر', marketer: 'المسوّق', delivery_method: 'طريقة التسليم' };

function SalesView() {
  const { data, loading, error } = useLoader<SalesBreakdown>(() => dashboardApi.getSalesBreakdown(), []);
  const [open, setOpen] = useState<{ group: string; value: string; label: string } | null>(null);

  if (open && data) return <SalesRecordsView {...open} onBack={() => setOpen(null)} />;
  if (loading) return <Loading />;
  if (error || !data) return <Empty text={error || 'لا توجد بيانات'} />;
  if (data.order_count === 0) return <Empty text="لا توجد مبيعات في هذا الموسم" />;

  const groups: [SalesGroupKey, SalesGroupRow[]][] = [
    ['status', data.by_status], ['marketer', data.by_marketer], ['delivery_method', data.by_delivery_method],
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Row label="إجمالي قيمة الفواتير" value={egp(data.total_sales)} strong tone="blue" />
        <Row label="عدد الفواتير / الأوردرات" value={data.order_count.toLocaleString('ar-EG')} />
        <Row label="إجمالي المحصّل فعلياً (عربون + محصّل من الشحن)" value={egp(data.total_cash_collected)} tone="green" />
        <Row label="  منها: عربون مدفوع" value={egp(data.total_deposits)} />
        <Row label="  منها: محصّل من شركة الشحن" value={egp(data.total_shipping_collected)} />
        <Row label="إجمالي المتبقي (مستحق لنا)" value={egp(data.total_outstanding)} tone="red" />
      </div>
      <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
        قيمة الفواتير ليست هي النقدية المحصّلة. إجمالي المبيعات في لوحة التحكم يشمل كل أوردرات الموسم
        {data.canceled_count > 0 && <> بما فيها {data.canceled_count.toLocaleString('ar-EG')} أوردر ملغي بقيمة {egp(data.canceled_value)}</>}.
      </p>

      <button
        disabled={!data.can_view_records}
        onClick={() => setOpen({ group: 'all', value: '', label: 'كل الأوردرات' })}
        className="w-full text-sm text-blue-700 hover:text-blue-900 disabled:text-gray-400 border border-blue-100 rounded-lg py-2"
      >
        عرض كل الأوردرات
      </button>

      {groups.map(([key, rows]) => (
        <div key={key}>
          <h3 className="text-sm font-bold text-gray-800 mb-2">حسب {GROUP_LABELS[key]}</h3>
          <div className="space-y-1.5">
            {rows.map(g => (
              <button
                key={g.value}
                disabled={!data.can_view_records}
                onClick={() => setOpen({ group: key, value: g.value, label: `${GROUP_LABELS[key]}: ${key === 'status' ? statusLabel(g.value) : g.value}` })}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-blue-50 disabled:hover:bg-gray-50 disabled:cursor-default rounded-lg transition text-right"
              >
                <span className="text-sm text-gray-700 flex items-center gap-1.5">
                  {key === 'status' ? statusLabel(g.value) : g.value} <span className="text-xs text-gray-400">({g.count.toLocaleString('ar-EG')})</span>
                  {data.can_view_records && <ChevronLeft size={14} className="text-gray-400" />}
                </span>
                <span className="text-left">
                  <span className="block text-sm font-bold text-blue-800">{egp(g.invoice_value)}</span>
                  <span className="block text-xs text-emerald-700">محصّل: {egp(g.deposit_paid + g.collected)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SalesRecordsView({ group, value, label, onBack }: { group: string; value: string; label: string; onBack: () => void }) {
  const { data, loading, error } = useLoader<SalesRecordsResult>(() => dashboardApi.getSalesRecords(group, value), [group, value]);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil((data?.records.length ?? 0) / PAGE_SIZE));
  const rows = (data?.records ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <div>
      <BackButton onClick={onBack} />
      <h3 className="text-sm font-bold text-gray-800 mb-2">{label}</h3>
      {loading ? <Loading /> : error || !data ? <Empty text={error || 'لا توجد بيانات'} /> : data.records.length === 0 ? <Empty /> : (
        <>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="text-right px-3 py-2 font-semibold">رقم الأوردر</th>
                  <th className="text-right px-3 py-2 font-semibold">التاريخ</th>
                  <th className="text-right px-3 py-2 font-semibold">العميل</th>
                  <th className="text-right px-3 py-2 font-semibold">الحالة</th>
                  <th className="text-right px-3 py-2 font-semibold">قيمة الفاتورة</th>
                  <th className="text-right px-3 py-2 font-semibold">المحصّل</th>
                  <th className="text-right px-3 py-2 font-semibold">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.order_number}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{r.date}</td>
                    <td className="px-3 py-2 text-gray-600">{r.client}</td>
                    <td className="px-3 py-2 text-gray-600">{statusLabel(r.order_status)}</td>
                    <td className="px-3 py-2 font-bold text-blue-700 whitespace-nowrap">{egp(r.invoice_value)}</td>
                    <td className="px-3 py-2 text-emerald-700 whitespace-nowrap">{egp(r.deposit_paid + r.shipping_collected)}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{egp(r.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} onPage={setPage} />
          <div className="mt-3"><Row label={`إجمالي الفواتير (${data.count.toLocaleString('ar-EG')})`} value={egp(data.total_invoice_value)} strong tone="blue" /></div>
        </>
      )}
    </div>
  );
}

export default function DashboardBreakdownModal({ kind, onClose }: { kind: BreakdownKind | null; onClose: () => void }) {
  return (
    <Modal isOpen={kind !== null} onClose={onClose} title={kind ? TITLES[kind] : ''} size="xl">
      {kind === 'net_profit' && <NetProfitView />}
      {kind === 'expenses' && <ExpensesView />}
      {kind === 'sales' && <SalesView />}
      <button onClick={onClose} className="w-full mt-4 border border-gray-200 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
        إغلاق
      </button>
    </Modal>
  );
}

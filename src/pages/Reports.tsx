import { useState, useRef } from 'react';
import { reportsApi, type ReportData, type CapitalSnapshot } from '../services/api';
import { useToast } from '../components/Toast';
import {
  BarChart2, Download, Printer, RefreshCw, TrendingUp, TrendingDown,
  ShoppingCart, DollarSign, AlertTriangle, BookOpen, Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
const fmtDec = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 1 });

function today() { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

// ─── small reusable pieces ───────────────────────────────────────────────────

function SectionHeader({ title, color = 'blue' }: { title: string; color?: string }) {
  const bg: Record<string, string> = {
    blue: 'bg-[#1e3a5f]', green: 'bg-emerald-700', orange: 'bg-orange-600',
    red: 'bg-red-700', purple: 'bg-purple-700', teal: 'bg-teal-700',
  };
  return (
    <div className={`${bg[color] ?? bg.blue} text-white px-5 py-3 rounded-t-xl font-bold text-sm`}>
      {title}
    </div>
  );
}

function KV({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-bold ${accent ?? 'text-gray-800'}`}>
        {typeof value === 'number' ? fmt(value) : value}
      </span>
    </div>
  );
}

function MiniCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    orange: 'bg-orange-50 border-orange-200 text-orange-800',
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
    yellow: 'bg-amber-50 border-amber-200 text-amber-800',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] ?? colors.blue}`}>
      <p className="text-xs opacity-70 mb-1">{label}</p>
      <p className="text-xl font-bold">{typeof value === 'number' ? fmt(value) : value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── capital growth snapshot row ─────────────────────────────────────────────

function SnapRow({ label, start, end }: { label: string; start: number; end: number }) {
  const diff = end - start;
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-2.5 text-sm font-medium text-gray-700">{label}</td>
      <td className="px-4 py-2.5 text-sm text-center text-gray-800">{fmt(start)}</td>
      <td className="px-4 py-2.5 text-sm text-center text-gray-800">{fmt(end)}</td>
      <td className={`px-4 py-2.5 text-sm text-center font-semibold ${diff >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
        {diff >= 0 ? '+' : ''}{fmt(diff)}
      </td>
    </tr>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Reports() {
  const toast = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const loadReport = async () => {
    if (!fromDate || !toDate) { toast('error', 'يرجى تحديد الفترة الزمنية'); return; }
    if (fromDate > toDate) { toast('error', 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية'); return; }
    setLoading(true);
    try {
      setData(await reportsApi.getReport(fromDate, toDate));
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في تحميل التقرير');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();

  const exportExcel = () => {
    if (!data) { toast('error', 'قم بتحميل التقرير أولاً'); return; }
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'البند': 'إجمالي المبيعات', 'القيمة': data.summary.total_sales },
      { 'البند': 'إجمالي المصروفات', 'القيمة': data.summary.total_expenses },
      { 'البند': 'صافي الربح', 'القيمة': data.summary.net_profit },
      { 'البند': 'إجمالي الحجوزات', 'القيمة': data.summary.total_reservations },
      { 'البند': 'إجمالي الديون', 'القيمة': data.summary.total_debts },
    ]), 'الملخص');

    // Sheet 2: Sales
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'البند': 'عدد الأوردرات', 'القيمة': data.sales_report.total_orders },
      { 'البند': 'إجمالي الفواتير', 'القيمة': data.sales_report.total_invoice_value },
      { 'البند': 'إجمالي العربون', 'القيمة': data.sales_report.total_deposits },
      { 'البند': 'إجمالي المتبقي', 'القيمة': data.sales_report.total_remaining },
      { 'البند': 'أفضل مسوق', 'القيمة': data.sales_report.top_marketer },
      { 'البند': 'أكثر موديل مبيعاً', 'القيمة': data.sales_report.top_model },
    ]), 'المبيعات');

    // Sheet 3: Marketers
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.sales_report.by_marketer.map(m => ({
        'المسوق': m.marketer, 'عدد الأوردرات': m.count,
        'قيمة المبيعات': m.value, 'المتبقي': m.remaining,
      }))
    ), 'المسوقون');

    // Sheet 4: Customers
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      data.customers_report.top_clients.map(c => ({
        'العميل': c.client, 'قيمة المبيعات': c.value, 'المتبقي': c.remaining,
      }))
    ), 'العملاء');

    // Sheet 5: Inventory
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'البند': 'إجمالي الكميات', 'القيمة': data.inventory_report.total_qty },
      { 'البند': 'الكمية المحجوزة', 'القيمة': data.inventory_report.reserved_qty },
      { 'البند': 'الكمية المتاحة', 'القيمة': data.inventory_report.available_qty },
      { 'البند': 'قيمة القماش', 'القيمة': data.inventory_report.fabric_value },
      { 'البند': 'قيمة الإكسسوارات', 'القيمة': data.inventory_report.accessories_value },
    ]), 'المخزون');

    // Sheet 6: Reservations
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'البند': 'عدد الحجوزات', 'القيمة': data.reservations_report.count },
      { 'البند': 'قيمة الحجوزات', 'القيمة': data.reservations_report.value },
      { 'البند': 'موديلات بعجز', 'القيمة': data.reservations_report.shortages.length },
      ...data.reservations_report.shortages.map(s => ({
        'البند': `عجز - ${s.model_code}`, 'القيمة': s.available,
      })),
    ]), 'الحجوزات');

    // Sheet 7: Capital Growth
    const { start, end } = data.capital_growth;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      { 'البند': 'الاستوك', 'أول المدة': start.stock_value, 'آخر المدة': end.stock_value, 'الفرق': end.stock_value - start.stock_value },
      { 'البند': 'القماش', 'أول المدة': start.fabric_value, 'آخر المدة': end.fabric_value, 'الفرق': end.fabric_value - start.fabric_value },
      { 'البند': 'الإكسسوارات', 'أول المدة': start.accessories_value, 'آخر المدة': end.accessories_value, 'الفرق': end.accessories_value - start.accessories_value },
      { 'البند': 'حسابات العملاء', 'أول المدة': start.client_accounts, 'آخر المدة': end.client_accounts, 'الفرق': end.client_accounts - start.client_accounts },
      { 'البند': 'النقدية', 'أول المدة': start.cash, 'آخر المدة': end.cash, 'الفرق': end.cash - start.cash },
      { 'البند': 'إجمالي الأصول', 'أول المدة': start.total_assets, 'آخر المدة': end.total_assets, 'الفرق': end.total_assets - start.total_assets },
      { 'البند': 'الديون', 'أول المدة': start.total_debts, 'آخر المدة': end.total_debts, 'الفرق': end.total_debts - start.total_debts },
      { 'البند': 'صافي الأصول', 'أول المدة': start.net_assets, 'آخر المدة': end.net_assets, 'الفرق': end.net_assets - start.net_assets },
    ]), 'تطور رأس المال');

    XLSX.writeFile(wb, `تقرير_${fromDate}_${toDate}.xlsx`);
  };

  // ─── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5" ref={printRef}>

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart2 size={24} className="text-[#1e3a5f]" /> التقارير
          </h1>
          <p className="text-sm text-gray-500">تقارير شاملة مع إمكانية التصفية بالتاريخ</p>
        </div>
      </div>

      {/* ── Filters bar (hidden when printing) ── */}
      <div className="print:hidden bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">من تاريخ</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">إلى تاريخ</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button onClick={loadReport} disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#16304d] disabled:opacity-60">
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <BarChart2 size={15} />}
            عرض التقرير
          </button>
          {data && <>
            <button onClick={exportExcel}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
              <Download size={15} /> تصدير Excel
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800">
              <Printer size={15} /> طباعة PDF
            </button>
          </>}
        </div>
      </div>

      {/* ── Print-only header ── */}
      {data && (
        <div className="hidden print:block text-center border-b pb-4 mb-4">
          <h1 className="text-2xl font-bold">تقارير نظام المصنع</h1>
          <p className="text-sm text-gray-600 mt-1">الفترة: {fromDate} — {toDate}</p>
        </div>
      )}

      {/* ── Empty state ── */}
      {!data && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 flex flex-col items-center gap-3 text-gray-400">
          <BarChart2 size={40} className="opacity-30" />
          <p>اختر الفترة الزمنية ثم اضغط «عرض التقرير»</p>
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 py-16 flex flex-col items-center gap-3 text-gray-400">
          <RefreshCw size={32} className="animate-spin opacity-40" />
          <p>جارٍ إنشاء التقرير...</p>
        </div>
      )}

      {data && !loading && <ReportBody data={data} fromDate={fromDate} toDate={toDate} />}
    </div>
  );
}

// ─── All report sections ──────────────────────────────────────────────────────

function ReportBody({ data, fromDate, toDate }: { data: ReportData; fromDate: string; toDate: string }) {
  const { summary, sales_report, inventory_report, financial_report, customers_report, reservations_report, capital_growth } = data;
  const hasShortages = reservations_report.shortages.length > 0;

  return (
    <div className="space-y-6">

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MiniCard label="إجمالي المبيعات" value={summary.total_sales} sub="كل الوقت" color="blue" />
        <MiniCard label="إجمالي المصروفات" value={summary.total_expenses} sub="كل الوقت" color="red" />
        <MiniCard label="صافي الربح" value={summary.net_profit} sub="كل الوقت" color={summary.net_profit >= 0 ? 'green' : 'red'} />
        <MiniCard label="إجمالي الحجوزات" value={summary.total_reservations} sub="نشطة حالياً" color="orange" />
        <MiniCard label="إجمالي الديون" value={summary.total_debts} sub="متبقٍ حالياً" color="yellow" />
      </div>

      <p className="text-xs text-gray-400 -mt-2">
        * ملاحظة: بيانات المبيعات والمالية والمسوقين والعملاء مُصفَّاة للفترة ({fromDate} → {toDate}). المخزون والحجوزات تعكس الوضع الحالي.
      </p>

      {/* ── Section 1: Sales ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <SectionHeader title="1. تقرير المبيعات" color="blue" />
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          <KV label="عدد الأوردرات" value={sales_report.total_orders} />
          <KV label="إجمالي قيمة الفواتير" value={sales_report.total_invoice_value} />
          <KV label="إجمالي العربون المدفوع" value={sales_report.total_deposits} />
          <KV label="إجمالي المبالغ المتبقية" value={sales_report.total_remaining} />
          <KV label="أفضل مسوق" value={sales_report.top_marketer || '—'} />
          <KV label="الموديل الأكثر مبيعاً" value={sales_report.top_model || '—'} />
        </div>
      </div>

      {/* ── Section 2: Inventory ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <SectionHeader title="2. تقرير المخزون (الوضع الحالي)" color="teal" />
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 mb-4">
            <KV label="إجمالي كمية الاستوك" value={inventory_report.total_qty} />
            <KV label="الكمية المحجوزة" value={inventory_report.reserved_qty} accent="text-orange-600" />
            <KV label="الكمية المتاحة" value={inventory_report.available_qty} accent={inventory_report.available_qty < 0 ? 'text-red-600' : 'text-emerald-700'} />
            <KV label="رصيد القماش (كجم)" value={Math.round(inventory_report.fabric_balance_kg)} />
            <KV label="قيمة القماش" value={inventory_report.fabric_value} />
            <KV label="رصيد الإكسسوارات" value={Math.round(inventory_report.accessories_balance)} />
            <KV label="قيمة الإكسسوارات" value={inventory_report.accessories_value} />
          </div>
          {inventory_report.low_stock.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                <AlertTriangle size={13} /> موديلات منخفضة المخزون (أقل من 10 قطع)
              </p>
              <div className="flex flex-wrap gap-2">
                {inventory_report.low_stock.map(m => (
                  <span key={m.model_code} className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-2 py-1 rounded-full">
                    {m.model_code} — {m.product_name}: {m.available} قطعة
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 3: Financial ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <SectionHeader title="3. التقرير المالي" color="green" />
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MiniCard label="إجمالي الإيرادات" value={financial_report.total_revenues} color="green" />
          <MiniCard label="إجمالي المصروفات" value={financial_report.total_expenses} color="red" />
          <MiniCard label="صافي الربح" value={financial_report.net_profit} color={financial_report.net_profit >= 0 ? 'green' : 'red'} />
        </div>
      </div>

      {/* ── Section 4: Marketers ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <SectionHeader title="4. تقرير المسوقين" color="purple" />
        {sales_report.by_marketer.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">لا توجد مبيعات في الفترة المحددة</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">المسوق</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">عدد الأوردرات</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">قيمة المبيعات</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">المتبقي</th>
                </tr>
              </thead>
              <tbody>
                {sales_report.by_marketer.map(m => (
                  <tr key={m.marketer} className="border-t border-gray-100 hover:bg-blue-50/30">
                    <td className="px-4 py-2.5 font-medium text-gray-800 flex items-center gap-2">
                      <Users size={14} className="text-purple-500" /> {m.marketer}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-600">{m.count}</td>
                    <td className="px-4 py-2.5 text-center font-semibold text-emerald-700">{fmt(m.value)}</td>
                    <td className="px-4 py-2.5 text-center text-orange-600">{fmt(m.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 5: Customers ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <SectionHeader title="5. تقرير العملاء" color="blue" />
        <div className="p-5 space-y-4">
          <KV label="إجمالي المبالغ المستحقة (مبيعات غير مصروفة + حسابات عملاء)" value={customers_report.total_outstanding} accent="text-orange-600" />
          {customers_report.top_clients.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">أبرز العملاء (حسب قيمة المشتريات)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">العميل</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600">قيمة المشتريات</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600">المتبقي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers_report.top_clients.map((c, i) => (
                      <tr key={i} className="border-t border-gray-100 hover:bg-blue-50/30">
                        <td className="px-3 py-2 font-medium text-gray-800">{c.client}</td>
                        <td className="px-3 py-2 text-center font-semibold text-emerald-700">{fmt(c.value)}</td>
                        <td className="px-3 py-2 text-center text-orange-600">{fmt(c.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {customers_report.debts.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1">
                <AlertTriangle size={13} /> ديون غير مسددة
              </p>
              <div className="space-y-1">
                {customers_report.debts.map((d, i) => (
                  <div key={i} className="flex justify-between items-center px-3 py-2 bg-red-50 rounded-lg border border-red-100 text-sm">
                    <span className="text-gray-700">{d.name}</span>
                    <span className="font-bold text-red-700">{fmt(d.remaining)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 6: Reservations ── */}
      <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${hasShortages ? 'border-red-300' : 'border-gray-200'}`}>
        <SectionHeader title="6. تقرير الحجوزات (الوضع الحالي)" color="orange" />
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
            <KV label="عدد الحجوزات النشطة" value={reservations_report.count} />
            <KV label="إجمالي قيمة الحجوزات" value={reservations_report.value} accent="text-orange-600" />
          </div>

          {reservations_report.items.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">موديلات بها كميات محجوزة</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-right font-semibold text-gray-600">الموديل</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600">الرصيد الفعلي</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600 text-orange-600">المحجوز</th>
                      <th className="px-3 py-2 text-center font-semibold text-gray-600">المتاح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations_report.items.map(item => (
                      <tr key={item.model_code} className={`border-t border-gray-100 ${item.available < 0 ? 'bg-red-50' : ''}`}>
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-800">{item.model_code}</span>
                          <span className="text-gray-500 text-xs mr-2">{item.product_name}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-700">{item.actual}</td>
                        <td className="px-3 py-2 text-center font-semibold text-orange-600">{item.reserved}</td>
                        <td className={`px-3 py-2 text-center font-bold ${item.available < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {item.available}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {hasShortages && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-bold text-red-700 mb-3 flex items-center gap-2">
                <AlertTriangle size={16} /> تحذير: موديلات بعجز في المخزون (المتاح سالب)
              </p>
              <div className="space-y-1">
                {reservations_report.shortages.map(s => (
                  <div key={s.model_code} className="flex items-center justify-between bg-white border border-red-100 rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium text-gray-800">{s.model_code} — {s.product_name}</span>
                    <span className="font-bold text-red-700">عجز: {Math.abs(s.available)} قطعة</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Section 7: Capital Growth ── */}
      <CapitalGrowthSection growth={capital_growth} fromDate={fromDate} toDate={toDate} />

    </div>
  );
}

// ─── Capital Growth Section ───────────────────────────────────────────────────

function CapitalGrowthSection({
  growth, fromDate, toDate,
}: {
  growth: ReportData['capital_growth'];
  fromDate: string;
  toDate: string;
}) {
  const { start, end, growth_amount, growth_percent } = growth;
  const isPositive = growth_amount >= 0;

  const growthCards = [
    { label: 'صافي الأصول أول المدة', value: start.net_assets, color: 'blue' as const },
    { label: 'صافي الأصول آخر المدة', value: end.net_assets, color: 'blue' as const },
    {
      label: 'النمو المالي',
      value: `${isPositive ? '+' : ''}${fmt(growth_amount)}`,
      color: (isPositive ? 'green' : 'red') as const,
    },
    {
      label: 'نسبة النمو %',
      value: growth_percent !== null ? `${isPositive ? '+' : ''}${fmtDec(growth_percent)}%` : '—',
      color: (isPositive ? 'green' : 'red') as const,
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <SectionHeader title="7. تطور رأس المال" color={isPositive ? 'green' : 'red'} />
      <div className="p-5 space-y-5">

        {/* Growth indicator */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${isPositive ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
          {isPositive
            ? <TrendingUp size={24} className="text-emerald-600 shrink-0" />
            : <TrendingDown size={24} className="text-red-600 shrink-0" />}
          <div>
            <p className={`font-bold ${isPositive ? 'text-emerald-800' : 'text-red-800'}`}>
              {isPositive ? 'نمو إيجابي' : 'انخفاض في رأس المال'} خلال الفترة ({fromDate} → {toDate})
            </p>
            <p className="text-xs text-gray-500">المقارنة بين لقطة الأصول في بداية ونهاية الفترة</p>
          </div>
        </div>

        {/* 4 summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {growthCards.map(c => (
            <MiniCard key={c.label} label={c.label} value={c.value} color={c.color} />
          ))}
        </div>

        {/* Comparison table */}
        <div>
          <p className="text-xs font-semibold text-gray-600 mb-2">جدول المقارنة التفصيلي</p>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">البند</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">أول المدة ({fromDate})</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">آخر المدة ({toDate})</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">الفرق</th>
                </tr>
              </thead>
              <tbody>
                <SnapRow label="الاستوك" start={start.stock_value} end={end.stock_value} />
                <SnapRow label="القماش" start={start.fabric_value} end={end.fabric_value} />
                <SnapRow label="الإكسسوارات" start={start.accessories_value} end={end.accessories_value} />
                <SnapRow label="حسابات العملاء" start={start.client_accounts} end={end.client_accounts} />
                <SnapRow label="النقدية (صافي الشركاء)" start={start.cash} end={end.cash} />
                <tr className="border-t-2 border-gray-300 bg-blue-50 font-bold">
                  <td className="px-4 py-3 text-sm text-blue-800">إجمالي الأصول المتداولة</td>
                  <td className="px-4 py-3 text-sm text-center text-blue-800">{fmt(start.total_assets)}</td>
                  <td className="px-4 py-3 text-sm text-center text-blue-800">{fmt(end.total_assets)}</td>
                  <td className={`px-4 py-3 text-sm text-center font-bold ${end.total_assets - start.total_assets >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {end.total_assets - start.total_assets >= 0 ? '+' : ''}{fmt(end.total_assets - start.total_assets)}
                  </td>
                </tr>
                <SnapRow label="الديون" start={start.total_debts} end={end.total_debts} />
                <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold">
                  <td className="px-4 py-3 text-sm font-extrabold text-gray-800">صافي الأصول</td>
                  <td className="px-4 py-3 text-sm text-center font-extrabold text-gray-800">{fmt(start.net_assets)}</td>
                  <td className="px-4 py-3 text-sm text-center font-extrabold text-gray-800">{fmt(end.net_assets)}</td>
                  <td className={`px-4 py-3 text-sm text-center font-extrabold ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>
                    {isPositive ? '+' : ''}{fmt(growth_amount)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Growth % banner */}
        {growth_percent !== null && (
          <div className={`text-center py-3 rounded-xl font-bold text-lg ${isPositive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
            {isPositive ? <TrendingUp className="inline mr-2" size={20} /> : <TrendingDown className="inline mr-2" size={20} />}
            نسبة النمو: {isPositive ? '+' : ''}{fmtDec(growth_percent)}%
          </div>
        )}
      </div>
    </div>
  );
}

// keep unused imports quiet
const _keep = { BookOpen, DollarSign, ShoppingCart };
void _keep;

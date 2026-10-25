import { useState, useEffect, useMemo } from 'react';
import StatCard from '../components/StatCard';
import Modal from '../components/Modal';
import { getDashboardMetrics } from '../data/store';
import type { DashboardMetrics } from '../types';
import {
  TrendingUp, TrendingDown, Wallet, AlertTriangle,
  DollarSign, ShoppingCart, ArrowLeftRight, RefreshCw, ChevronLeft, ChevronRight,
  Search, ArrowUpDown
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import ProfitByPeriod from '../components/ProfitByPeriod';
import DashboardBreakdownModal, { type BreakdownKind } from '../components/DashboardBreakdownModal';
import CharitySection from '../components/CharitySection';
import { statusLabel } from '../utils/orderStatus';
import ReceivablesAuditModal from '../components/ReceivablesAuditModal';
import CashReconciliationModal from '../components/CashReconciliationModal';
import SalesReportsTab from '../components/dashboard/SalesReportsTab';
import InventoryReportsTab from '../components/dashboard/InventoryReportsTab';
import ProductionTab from '../components/dashboard/ProductionTab';
import DelayedCollectionsTab from '../components/dashboard/DelayedCollectionsTab';
import { Panel, ExportButton, exportRows } from '../components/dashboard/reportKit';
import MissingStockSummary from '../components/MissingStockSummary';
import { useAuth } from '../contexts/AuthContext';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const EMPTY: DashboardMetrics = {
  total_sales: 0, total_expenses: 0, net_profit: 0, remaining_debts: 0,
  total_in: 0, total_out: 0, cash_available: 0, money_owed_to_us: 0,
  sales_by_marketer: {}, order_status_counts: {}, total_returns: 0, total_refunds: 0,
  total_current_assets: 0, fabric_value: 0, stock_value: 0, accessories_value: 0,
  cutting_value: 0, wip_value: 0, total_reservations: 0,
  fabric_items: [], stock_items: [], accessories_items: [], cutting_items: [], wip_items: [], receivable_items: [],
};

const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

type CategoryKey = 'fabric' | 'stock' | 'accessories' | 'cutting' | 'wip' | 'receivables' | 'cash';

const PAGE_SIZE = 10;

type TabKey = 'overview' | 'financial' | 'sales' | 'inventory' | 'production' | 'collections';
const TAB_STORE = 'dashboard_tab';
const readTab = (): TabKey => {
  try { const v = sessionStorage.getItem(TAB_STORE); if (v && ['overview', 'financial', 'sales', 'inventory', 'production', 'collections'].includes(v)) return v as TabKey; } catch { /* storage unavailable */ }
  return 'overview';
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [cardBreakdown, setCardBreakdown] = useState<BreakdownKind | null>(null);
  const { can } = useAuth();
  const canDetails = can('dashboard.view');
  const [tab, setTabState] = useState<TabKey>(readTab);
  const setTab = (t: TabKey) => { setTabState(t); try { sessionStorage.setItem(TAB_STORE, t); } catch { /* ignore */ } };
  const [auditOpen, setAuditOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [detailCategory, setDetailCategory] = useState<CategoryKey | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortDesc, setSortDesc] = useState(true);

  const loadData = async () => {
    try {
      setMetrics(await getDashboardMetrics());
    } catch (err) {
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const pieData = Object.entries(metrics.sales_by_marketer).map(([name, value]) => ({ name, value }));
  const barData = Object.entries(metrics.order_status_counts).map(([name, value]) => ({ name: statusLabel(name), value }));

  const assetBreakdown: { key: CategoryKey; label: string; val: number }[] = [
    { key: 'fabric', label: 'القماش المتاح × التكلفة', val: metrics.fabric_value },
    { key: 'stock', label: 'الاستوك الفعلي (متاح + محجوز) × التكلفة', val: metrics.stock_value },
    { key: 'accessories', label: 'الإكسسوارات × التكلفة', val: metrics.accessories_value },
    { key: 'cutting', label: 'قطع متبقية × تكلفة المتر', val: metrics.cutting_value },
    { key: 'wip', label: 'قيمة التشغيل (قيد التشغيل)', val: metrics.wip_value },
    { key: 'receivables', label: 'الفلوس اللي لنا برا (حسابات العملاء)', val: metrics.money_owed_to_us },
    // Real money in hand (= «الصافي» above). Not «الكاش المتاح», and not the receivables line.
    { key: 'cash', label: 'الكاش الفعلي بالخزنة', val: metrics.cash_on_hand ?? metrics.net_profit },
  ];

  const openCategory = (key: CategoryKey) => {
    setDetailCategory(key);
    setSearch('');
    setPage(1);
    setSortDesc(true);
  };

  const closeBreakdown = () => {
    setBreakdownOpen(false);
    setDetailCategory(null);
    setSearch('');
    setPage(1);
  };

  // Filtered + sorted + paginated rows for whichever category is currently open, typed per-category below.
  const detailData = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortNum = (a: number, b: number) => (sortDesc ? b - a : a - b);

    if (detailCategory === 'fabric') {
      const rows = metrics.fabric_items
        .filter(i => !q || i.material_type.toLowerCase().includes(q) || i.color.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.total, b.total));
      return { rows, total: metrics.fabric_value };
    }
    if (detailCategory === 'stock') {
      const rows = metrics.stock_items
        .filter(i => !q || i.model_code.toLowerCase().includes(q) || i.product_name.toLowerCase().includes(q) || i.color.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.total, b.total));
      return { rows, total: metrics.stock_value };
    }
    if (detailCategory === 'accessories') {
      const rows = metrics.accessories_items
        .filter(i => !q || i.item_name.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.total, b.total));
      return { rows, total: metrics.accessories_value };
    }
    if (detailCategory === 'cutting') {
      const rows = metrics.cutting_items
        .filter(i => !q || String(i.cut_number).includes(q) || i.cut_description.toLowerCase().includes(q) || i.material_type.toLowerCase().includes(q) || i.color.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.total, b.total));
      return { rows, total: metrics.cutting_value };
    }
    if (detailCategory === 'wip') {
      const rows = metrics.wip_items
        .filter(i => !q || i.model_code.toLowerCase().includes(q) || i.model_description.toLowerCase().includes(q) || i.color.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.total, b.total));
      return { rows, total: metrics.wip_value };
    }
    if (detailCategory === 'cash') {
      // Natural order (inflows, then outflows) — sorting by amount would interleave them.
      const rows = (metrics.cash_items ?? []).filter(i => !q || i.label.toLowerCase().includes(q));
      return { rows, total: metrics.cash_on_hand ?? metrics.net_profit };
    }
    if (detailCategory === 'receivables') {
      const rows = metrics.receivable_items
        .filter(i => !q || i.name.toLowerCase().includes(q) || i.reference.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.remaining, b.remaining));
      return { rows, total: metrics.money_owed_to_us };
    }
    return { rows: [] as never[], total: 0 };
  }, [detailCategory, metrics, search, sortDesc]);

  // Split of «الفلوس اللي لنا برا»: owed by the shipping company vs client accounts — different debts,
  // each counted once. Flags show shipped goods still valued in stock, or the same debt entered twice.
  const receivableSplit = useMemo(() => {
    const rows = metrics.receivable_items;
    return {
      shipping: rows.filter(i => i.source !== 'client_account').reduce((n, i) => n + i.remaining, 0),
      clients: rows.filter(i => i.source === 'client_account').reduce((n, i) => n + i.remaining, 0),
      stillInStock: rows.filter(i => i.inventory_still_in_stock).length,
      duplicates: rows.filter(i => i.duplicate_in_client_account).length,
    };
  }, [metrics.receivable_items]);
  const recon = metrics.assets_reconciliation;
  const reconDiffs = recon ? Object.entries(recon.differences).filter(([, d]) => Math.abs(d) >= 0.01) : [];

  const canSales = can('sales.view');
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'نظرة عامة' },
    { key: 'financial', label: 'التقارير المالية' },
    ...(canSales ? [{ key: 'sales' as TabKey, label: 'تقارير المبيعات' }] : []),
    { key: 'inventory', label: 'المخزون والخامات' },
    ...(can('model_prod.view') ? [{ key: 'production' as TabKey, label: 'الإنتاج والتجهيز' }] : []),
    ...(canSales ? [{ key: 'collections' as TabKey, label: 'التحصيلات المتأخرة' }] : []),
  ];
  const activeTab: TabKey = tabs.some(t => t.key === tab) ? tab : 'overview';
  const attentionItems: { label: string; value: string; hint: string; tab: TabKey; alert: boolean }[] = [
    ...(canSales ? [{ label: 'مستحق عند شركة الشحن', value: `${fmt(metrics.shipping_receivable ?? 0)} ج.م`, hint: 'التحصيلات المتأخرة', tab: 'collections' as TabKey, alert: (metrics.shipping_receivable ?? 0) > 0 }] : []),
    { label: 'قطع ناقصة لأوردرات التجهيز', value: `${fmt(metrics.pending_units ?? 0)} قطعة`, hint: 'النواقص والمخزون', tab: 'inventory' as TabKey, alert: (metrics.pending_units ?? 0) > 0 },
    ...(can('model_prod.view') ? [{ label: 'أوردرات التجهيز', value: `${fmt(metrics.reserved_orders_count ?? 0)} أوردر`, hint: 'الإنتاج والتجهيز', tab: 'production' as TabKey, alert: (metrics.pending_orders?.length ?? 0) > 0 }] : []),
    { label: 'المتبقي من الديون', value: `${fmt(metrics.remaining_debts)} ج.م`, hint: 'التقارير المالية', tab: 'financial' as TabKey, alert: metrics.remaining_debts > 0 },
  ];
  const totalPages = Math.max(1, Math.ceil(detailData.rows.length / PAGE_SIZE));
  const pagedRows = detailData.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const categoryLabel = assetBreakdown.find(a => a.key === detailCategory)?.label || '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">📊 لوحة التحكم</h1>
          <p className="text-sm text-gray-500">نظرة عامة على أداء المصنع</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-400">{new Date().toLocaleDateString('ar-EG')}</div>
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition" title="تحديث">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <RefreshCw size={20} className="animate-spin mr-2" /> جارٍ تحميل الإحصائيات...
        </div>
      )}

      {!loading && <>
        {/* Dashboard sections */}
        <div role="tablist" aria-label="أقسام لوحة التحكم" className="flex gap-1 overflow-x-auto border-b border-gray-200 -mb-2">
          {tabs.map(t => (
            <button key={t.key} role="tab" id={`tab-${t.key}`} aria-selected={activeTab === t.key} aria-controls="dashboard-panel" type="button" onClick={() => setTab(t.key)}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition ${activeTab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div id="dashboard-panel" role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="space-y-6">
        {activeTab === 'overview' && <>

        {/* Needs attention: every item opens the report that explains it */}
        <section aria-label="تنبيهات تحتاج متابعة" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h2 className="text-base font-bold text-gray-800 mb-3">يحتاج متابعة</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            {attentionItems.map(a => (
              <button key={a.label} type="button" onClick={() => setTab(a.tab)} className={`text-right rounded-lg border p-3 hover:shadow-sm transition ${a.alert ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                <span className="block text-xs text-gray-500">{a.label}</span>
                <span className={`block font-bold ${a.alert ? 'text-amber-800' : 'text-gray-700'}`}>{a.value}</span>
                <span className="block text-[11px] text-blue-700 mt-1">{a.hint} ←</span>
              </button>
            ))}
          </div>
        </section>
        {/* Top Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="إجمالي المبيعات" value={metrics.total_sales} icon={<ShoppingCart size={22} />} color="blue" onDetails={canDetails ? () => setCardBreakdown('sales') : undefined} />
          <StatCard title="إجمالي المصاريف" value={metrics.total_expenses} icon={<TrendingDown size={22} />} color="red" onDetails={canDetails ? () => setCardBreakdown('expenses') : undefined} />
          <StatCard title="صافي الربح" value={metrics.net_profit} icon={metrics.net_profit >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />} color={metrics.net_profit >= 0 ? 'green' : 'red'} onDetails={canDetails ? () => setCardBreakdown('net_profit') : undefined} />
          <StatCard title="المتبقي من الديون" value={metrics.remaining_debts} icon={<AlertTriangle size={22} />} color="yellow" alert={metrics.remaining_debts > 0} />
        </div>

        {/* Reservations Banner */}
        {metrics.total_reservations > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-orange-700">🔖 الحجوزات النشطة</span>
            <span className="text-lg font-bold text-orange-700">إجمالي الحجوزات: {metrics.total_reservations.toLocaleString('ar-EG')}</span>
          </div>
        )}

        {/* Consolidated shortage per model + colour for the production / purchasing team */}
        {metrics.missing_stock && metrics.missing_stock.rows.length > 0 && <MissingStockSummary summary={metrics.missing_stock} />}

        {/* Operational: accepted orders still waiting for goods to be produced / purchased (NOT assets) */}
        {(metrics.pending_orders?.length ?? 0) > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-base font-bold text-red-800">⏳ أوردرات «يتم التجهيز» في انتظار الإنتاج / الشراء</h2>
              <span className="text-sm font-semibold text-red-700">إجمالي الناقص: {(metrics.pending_units ?? 0).toLocaleString('ar-EG')} قطعة</span>
            </div>
            <div className="overflow-x-auto bg-white rounded-lg border border-red-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-red-50 text-red-900">
                    {['الأوردر', 'العميل', 'المطلوب', 'محجوز (موجود)', 'ناقص', 'الأصناف الناقصة'].map(h => <th key={h} className="text-right px-3 py-2 font-semibold">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-red-50">
                  {(metrics.pending_orders ?? []).map(o => (
                    <tr key={o.sale_id}>
                      <td className="px-3 py-2 font-medium text-gray-800">#{o.sale_id} · {o.order_number}</td>
                      <td className="px-3 py-2 text-gray-600">{o.client}</td>
                      <td className="px-3 py-2">{o.requested.toLocaleString('ar-EG')}</td>
                      <td className="px-3 py-2 text-orange-700">{o.reserved.toLocaleString('ar-EG')}</td>
                      <td className="px-3 py-2 font-bold text-red-700">{o.pending.toLocaleString('ar-EG')}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs">
                        {o.slots.map(x => `${x.code}${x.color ? ` (${x.color})` : ''}: ناقص ${x.pending}${x.has_card ? '' : ' — لا يوجد كارت مخزون'}`).join('، ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-red-700/70 mt-2">هذه الكميات لم تُنتج أو تُشترَ بعد، فلا تدخل في المخزون ولا في الأصول، ولا يمكن شحنها حتى تتوفر فعليًا.</p>
          </div>
        )}

        </>}

        {activeTab === 'financial' && <>
        {/* Sales recognition, cost, receivables and advances — separate metrics, none of them added to cash */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-800 mb-1">المبيعات والتكلفة والمستحقات</h2>
          <p className="text-xs text-gray-400 mb-4">مؤشرات منفصلة — لا تدخل قيمة الفاتورة في الكاش إلا بعد التحصيل الفعلي</p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">مبيعات خرجت من المصنع (معترف بها)</p><p className="font-bold text-blue-800">{fmt(metrics.recognized_sales ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">تكلفة البضاعة المباعة (بتكلفة الشحن المسجّلة)</p><p className="font-bold text-red-700">{fmt(metrics.cogs ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">هامش إجمالي (للأوردرات المسجّلة التكلفة)</p><p className="font-bold text-emerald-700">{fmt(metrics.gross_margin ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">مستحق عند شركة الشحن</p><p className="font-bold text-purple-700">{fmt(metrics.shipping_receivable ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">عربون على حجوزات لم تُشحن (التزام)</p><p className="font-bold text-amber-700">{fmt(metrics.advances_on_open_reservations ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">التزام رد عربون لعملاء (أوردرات ملغاة)</p><p className="font-bold text-amber-700">{fmt(metrics.advances_on_canceled_orders ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">التزام رد لشركة الشحن (أوردرات ملغاة)</p><p className="font-bold text-amber-700">{fmt(metrics.shipping_repayment_due ?? 0)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">بضاعة ملغاة لم تعد للمخزون الصالح للبيع</p><p className="font-bold text-red-700">{(metrics.cancelled_orders?.goods_outside.qty ?? 0).toLocaleString('ar-EG')} قطعة · {fmt(metrics.cancelled_orders?.goods_outside.cost ?? 0)} ج.م</p></div>
          </div>
          {((metrics.advances_on_canceled_orders ?? 0) > 0 || (metrics.shipping_repayment_due ?? 0) > 0) && (
            <p className="text-xs text-amber-700 mt-3">الأوردرات الملغاة: العربون والمحصّل من شركة الشحن ما زالا في الكاش حتى تسجّل الرد الفعلي من نافذة الأوردر — الإلغاء وحده لا يُرجع أي فلوس.</p>
          )}
          {(metrics.uncosted_shipped_orders ?? 0) > 0 && (
            <p className="text-xs text-amber-700 mt-3">{(metrics.uncosted_shipped_orders ?? 0).toLocaleString('ar-EG')} أوردر مشحون لا توجد له تكلفة مسجّلة (قبل تفعيل سجل التكلفة) — لا يدخل في التكلفة والهامش أعلاه.</p>
          )}
          {(metrics.receivable_overlap_orders ?? 0) > 0 && (
            <p className="text-xs text-red-700 mt-3">
              تنبيه: {(metrics.receivable_overlap_orders ?? 0).toLocaleString('ar-EG')} أوردر ({fmt(metrics.receivable_overlap_amount ?? 0)} ج.م) مسجّل كمستحق على شركة الشحن وكفاتورة في حساب عميل معًا — يُحسب مرتين في «الفلوس اللي لنا برا».
            </p>
          )}
          {can('sales.view') && (
            <button onClick={() => setAuditOpen(true)} className="mt-3 text-xs text-blue-700 hover:underline">تدقيق الأوردرات «لم يتم الصرف» والمستحقات ←</button>
          )}
          <p className="text-xs text-gray-400 mt-2">الحجوزات ({(metrics.reserved_orders_count ?? 0).toLocaleString('ar-EG')} أوردر) تُعرض كقسم تشغيلي منفصل ولا تُحسب ضمن الأصول.</p>
        </div>

        {/* Financial Summary */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Wallet size={20} className="text-blue-600" /> ملخص مالي
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-center px-6 py-3 font-semibold text-gray-600">إجمالي الوارد</th>
                  <th className="text-center px-6 py-3 font-semibold text-gray-600">إجمالي المصاريف</th>
                  <th className="text-center px-6 py-3 font-semibold text-gray-600">الصافي</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-gray-100">
                  <td className="px-6 py-4 text-center text-emerald-700 font-bold text-lg">{metrics.total_in.toLocaleString('ar-EG')}</td>
                  <td className="px-6 py-4 text-center text-red-700 font-bold text-lg">{metrics.total_out.toLocaleString('ar-EG')}</td>
                  <td className={`px-6 py-4 text-center font-bold text-lg ${metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {canDetails ? (
                      <button type="button" onClick={() => setCashOpen(true)} title="عرض تقرير مطابقة الكاش" className="underline decoration-dotted underline-offset-4 hover:opacity-80">
                        {metrics.net_profit.toLocaleString('ar-EG')}
                      </button>
                    ) : metrics.net_profit.toLocaleString('ar-EG')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="الكاش المتاح" value={metrics.cash_available} subtitle="الوارد الكلي − الديون − المصاريف" icon={<Wallet size={22} />} color={metrics.cash_available >= 0 ? 'green' : 'red'} />
          <StatCard title="الفلوس اللي لنا برا" value={metrics.money_owed_to_us} subtitle="مبيعات غير مصروفة + حسابات عملاء" icon={<DollarSign size={22} />} color="purple" alert={metrics.money_owed_to_us > 0} />
          <StatCard title="إجمالي الحجوزات" value={metrics.total_reservations} subtitle="قيمة الأوردرات المحجوزة" icon={<ShoppingCart size={22} />} color="orange" alert={metrics.total_reservations > 0} />
        </div>

        {metrics.total_returns > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowLeftRight size={20} className="text-orange-600" />
              <span className="font-bold text-orange-800">المرتجعات: {metrics.total_returns}</span>
            </div>
            <span className="text-lg font-bold text-orange-700">إجمالي الاسترجاع: {metrics.total_refunds.toLocaleString('ar-EG')}</span>
          </div>
        )}

        {/* Total Assets */}
        <div className="bg-gradient-to-l from-[#1e3a5f] to-[#2d5a8e] rounded-xl p-6 text-white shadow-lg">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Wallet size={22} /> إجمالي الأصول الحالية</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {assetBreakdown.map(item => (
              <div key={item.label} className="bg-white/10 rounded-lg p-3">
                <p className="text-xs text-white/70">{item.label}</p>
                <p className="text-lg font-bold">{item.val.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setBreakdownOpen(true)}
            className="w-full bg-white/10 hover:bg-white/20 transition rounded-lg p-4 flex items-center justify-between text-right"
          >
            <div className="flex items-center gap-2 text-white/70">
              <ChevronLeft size={16} />
              <span className="text-sm">عرض تفاصيل الحساب</span>
            </div>
            <div className="text-left">
              <p className="text-xs text-white/50">المجموع الكلي</p>
              <p className={`text-2xl font-bold ${metrics.total_current_assets >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {metrics.total_current_assets.toLocaleString('ar-EG')}
              </p>
            </div>
          </button>
        </div>

        <Modal
          isOpen={breakdownOpen}
          onClose={closeBreakdown}
          title={detailCategory ? categoryLabel : 'تفاصيل إجمالي الأصول الحالية'}
          size={detailCategory ? 'xl' : 'md'}
        >
          {!detailCategory ? (
            <div className="space-y-2">
              {assetBreakdown.map(item => (
                <button
                  key={item.key}
                  onClick={() => openCategory(item.key)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-blue-50 rounded-lg transition text-right"
                >
                  <span className="text-sm text-gray-600 flex items-center gap-1.5">
                    {item.label}
                    <ChevronLeft size={14} className="text-gray-400" />
                  </span>
                  <span className="text-sm font-bold text-gray-800">{fmt(item.val)} ج.م</span>
                </button>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg mt-3">
                <span className="text-sm font-semibold text-blue-800">المجموع الكلي</span>
                <span className="text-lg font-bold text-blue-800">{fmt(metrics.total_current_assets)} ج.م</span>
              </div>
              {recon && (
                recon.reconciled ? (
                  <p className="text-xs text-emerald-700 pt-2">✓ مجموع البنود ومجموع تفاصيل كل بند يطابقان الإجمالي.</p>
                ) : (
                  <p className="text-xs text-red-700 pt-2">
                    ⚠ عدم تطابق بين الإجمالي وتفاصيله ({reconDiffs.map(([k, d]) => `${k}: ${fmt(d)}`).join('، ') || 'مجموع البنود'}).
                  </p>
                )
              )}
              <p className="text-xs text-gray-400 pt-2">
                الأصول الثابتة غير مشمولة في هذا الإجمالي — راجع صفحة المركز المالي لعرضها بشكل منفصل.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button
                  onClick={() => { setDetailCategory(null); setSearch(''); setPage(1); }}
                  className="flex items-center gap-1.5 text-sm text-blue-700 hover:text-blue-900 font-medium"
                >
                  <ChevronRight size={16} /> رجوع
                </button>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={search}
                      onChange={e => { setSearch(e.target.value); setPage(1); }}
                      placeholder="بحث..."
                      className="border border-gray-300 rounded-lg pr-8 pl-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                  <button
                    onClick={() => setSortDesc(v => !v)}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg px-2 py-1.5"
                    title="ترتيب حسب القيمة"
                  >
                    <ArrowUpDown size={13} /> {sortDesc ? 'الأعلى أولاً' : 'الأقل أولاً'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                {detailCategory === 'fabric' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">نوع القماش</th>
                        <th className="text-right px-3 py-2 font-semibold">اللون</th>
                        <th className="text-right px-3 py-2 font-semibold">الكمية المتاحة</th>
                        <th className="text-right px-3 py-2 font-semibold">تكلفة الوحدة</th>
                        <th className="text-right px-3 py-2 font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['fabric_items']).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.material_type}</td>
                          <td className="px-3 py-2 text-gray-600">{it.color || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.available_qty)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.unit_cost)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailCategory === 'stock' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">كود الموديل</th>
                        <th className="text-right px-3 py-2 font-semibold">اسم المنتج</th>
                        <th className="text-right px-3 py-2 font-semibold">اللون</th>
                        <th className="text-right px-3 py-2 font-semibold">الفعلي</th>
                        <th className="text-right px-3 py-2 font-semibold">المحجوز</th>
                        <th className="text-right px-3 py-2 font-semibold">المتاح</th>
                        <th className="text-right px-3 py-2 font-semibold">ناقص (مطلوب)</th>
                        <th className="text-right px-3 py-2 font-semibold">تكلفة الوحدة</th>
                        <th className="text-right px-3 py-2 font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['stock_items']).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.model_code}</td>
                          <td className="px-3 py-2 text-gray-600">{it.product_name}</td>
                          <td className="px-3 py-2 text-gray-600">{it.color || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.actual_qty)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.reserved_qty)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.available_qty)}</td>
                          <td className={`px-3 py-2 ${(it.pending_qty ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{(it.pending_qty ?? 0) > 0 ? fmt(it.pending_qty ?? 0) : '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.unit_cost)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailCategory === 'accessories' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">اسم الإكسسوار</th>
                        <th className="text-right px-3 py-2 font-semibold">الكمية</th>
                        <th className="text-right px-3 py-2 font-semibold">تكلفة الوحدة</th>
                        <th className="text-right px-3 py-2 font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['accessories_items']).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.item_name}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.qty)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.unit_cost)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailCategory === 'cutting' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">رقم القصة</th>
                        <th className="text-right px-3 py-2 font-semibold">الوصف / الخامة</th>
                        <th className="text-right px-3 py-2 font-semibold">اللون</th>
                        <th className="text-right px-3 py-2 font-semibold">إجمالي القطع</th>
                        <th className="text-right px-3 py-2 font-semibold">المستخدم</th>
                        <th className="text-right px-3 py-2 font-semibold">المتبقي</th>
                        <th className="text-right px-3 py-2 font-semibold">تكلفة المتر</th>
                        <th className="text-right px-3 py-2 font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['cutting_items']).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.cut_number}</td>
                          <td className="px-3 py-2 text-gray-600">{it.cut_description || it.material_type}</td>
                          <td className="px-3 py-2 text-gray-600">{it.color || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.total_pieces)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.used_pieces)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.remaining_pieces)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.cost_per_meter)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailCategory === 'wip' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">كود الموديل</th>
                        <th className="text-right px-3 py-2 font-semibold">الوصف</th>
                        <th className="text-right px-3 py-2 font-semibold">اللون</th>
                        <th className="text-right px-3 py-2 font-semibold">الكمية المستلمة</th>
                        <th className="text-right px-3 py-2 font-semibold">تكلفة القطعة</th>
                        <th className="text-right px-3 py-2 font-semibold">الإجمالي</th>
                        <th className="text-right px-3 py-2 font-semibold">الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['wip_items']).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.model_code}</td>
                          <td className="px-3 py-2 text-gray-600">{it.model_description}</td>
                          <td className="px-3 py-2 text-gray-600">{it.color || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.qty_received)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.cost_per_piece)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.total)}</td>
                          <td className="px-3 py-2 text-gray-600">{it.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailCategory === 'cash' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">البند</th>
                        <th className="text-right px-3 py-2 font-semibold">النوع</th>
                        <th className="text-right px-3 py-2 font-semibold">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as NonNullable<DashboardMetrics['cash_items']>).map(it => (
                        <tr key={it.key}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.label}</td>
                          <td className={`px-3 py-2 ${it.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{it.direction === 'in' ? 'وارد' : 'منصرف'}</td>
                          <td className={`px-3 py-2 font-bold ${it.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{it.direction === 'out' ? '−' : ''}{fmt(it.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailCategory === 'receivables' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-600">
                        <th className="text-right px-3 py-2 font-semibold">العميل</th>
                        <th className="text-right px-3 py-2 font-semibold">المصدر</th>
                        <th className="text-right px-3 py-2 font-semibold">المرجع</th>
                        <th className="text-right px-3 py-2 font-semibold">إجمالي الفاتورة</th>
                        <th className="text-right px-3 py-2 font-semibold">المدفوع</th>
                        <th className="text-right px-3 py-2 font-semibold">المتبقي</th>
                        <th className="text-right px-3 py-2 font-semibold">البضاعة في المخزون؟</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['receivable_items']).map((it, idx) => (
                        <tr key={idx} className={it.inventory_still_in_stock || it.duplicate_in_client_account ? 'bg-amber-50/60' : ''}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.name}</td>
                          <td className="px-3 py-2 text-gray-600">
                            {it.source === 'sale' ? 'مشحون — مستحق على شركة الشحن' : it.source === 'sale_shipping_gap' ? 'فرق تحصيل أوردر مصروف' : 'حساب عميل'}
                            {it.duplicate_in_client_account && <span className="block text-xs text-red-600">⚠ مسجّل أيضًا في حساب عميل (يُعدّ مرتين)</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{it.reference || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.invoice_total)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.paid)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.remaining)}</td>
                          <td className={`px-3 py-2 text-xs ${it.inventory_still_in_stock ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>
                            {it.source === 'client_account' ? '—'
                              : it.inventory_still_in_stock ? 'نعم — ما زالت مُقيَّمة في المخزون'
                              : it.stock_status === 'no_stock_card' ? 'لا — لا يوجد كارت مخزون'
                              : 'لا — خُصمت من المخزون'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {detailData.rows.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">لا توجد سجلات مطابقة</div>
                )}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                  >
                    <ChevronRight size={13} /> السابق
                  </button>
                  <span>صفحة {page} من {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                  >
                    التالي <ChevronLeft size={13} />
                  </button>
                </div>
              )}

              {detailCategory === 'cash' && (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg"><span className="text-gray-600">الكاش المتاح (بعد خصم الديون المتبقية)</span><span className="font-bold">{fmt(metrics.cash_available)} ج.م</span></div>
                  <p className="text-xs text-gray-400">الكاش الفعلي = إجمالي الوارد − إجمالي المنصرف (نفس رقم «الصافي» أعلى الصفحة). «الكاش المتاح» رقم مختلف لأنه يخصم الديون. المستحقات لدى العملاء وشركة الشحن غير داخلة هنا — تتحول إلى كاش فقط عند تحصيلها فعليًا، وتُحسب مرة واحدة في أحدهما.</p>
                </div>
              )}

              {detailCategory === 'stock' && (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg"><span className="text-gray-600">متاح للبيع</span><span className="font-bold">{fmt(metrics.stock_available_value ?? 0)} ج.م</span></div>
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg"><span className="text-gray-600">محجوز لأوردرات لم تُشحن (ما زال في المصنع)</span><span className="font-bold">{fmt(metrics.stock_reserved_value ?? 0)} ج.م</span></div>
                  <p className="text-xs text-gray-400">الإجمالي = الكمية الفعلية × التكلفة (متاح + محجوز). الحجز لا يغيّر إجمالي الأصول، والبضاعة المشحونة خرجت من هذا الرقم، والكميات الناقصة (لم تُنتج/تُشترَ بعد) لا تدخل فيه.</p>
                </div>
              )}

              {detailCategory === 'receivables' && (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg"><span className="text-gray-600">مستحق على شركة الشحن (مشحون ولم يُحصَّل)</span><span className="font-bold">{fmt(receivableSplit.shipping)} ج.م</span></div>
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 rounded-lg"><span className="text-gray-600">حسابات العملاء</span><span className="font-bold">{fmt(receivableSplit.clients)} ج.م</span></div>
                  <p className="text-xs text-gray-400">البضاعة المشحونة تخرج من المخزون والمستحق يُحسب بقيمته فقط — لا تُخصم التكلفة من المستحق. الحجوزات غير المشحونة تبقى في المخزون ولا تظهر هنا.</p>
                  {receivableSplit.stillInStock > 0 && <p className="text-xs text-red-700">⚠ {receivableSplit.stillInStock.toLocaleString('ar-EG')} أوردر مشحون ما زالت بضاعته مُقيَّمة في المخزون (اللون لا يطابق كارت المخزون أو رصيد الكارت أقل من المشحون) — يُحسب أصلًا مرتين.</p>}
                  {receivableSplit.duplicates > 0 && <p className="text-xs text-red-700">⚠ {receivableSplit.duplicates.toLocaleString('ar-EG')} أوردر مسجّل كمستحق على شركة الشحن وكفاتورة في حساب عميل — يُحسب مرتين.</p>}
                </div>
              )}

              <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg">
                <span className="text-sm font-semibold text-blue-800">إجمالي {categoryLabel}</span>
                <span className="text-lg font-bold text-blue-800">{fmt(detailData.total)} ج.م</span>
              </div>

              <button
                onClick={closeBreakdown}
                className="w-full border border-gray-200 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                إغلاق
              </button>
            </div>
          )}
        </Modal>

        <ReceivablesAuditModal isOpen={auditOpen} onClose={() => setAuditOpen(false)} />
        <CashReconciliationModal isOpen={cashOpen} onClose={() => setCashOpen(false)} />
        <DashboardBreakdownModal kind={cardBreakdown} onClose={() => setCardBreakdown(null)} />

        {/* Monthly charity — a payment creates a real expense, so refresh the totals above after any change */}
        {can('expenses.view') && <CharitySection onChanged={loadData} />}

        {/* Profit by Period */}
        <ProfitByPeriod />


        {/* Cash in / out by item — the lines behind إجمالي الوارد والمنصرف (same numbers as the summary above) */}
        {(metrics.cash_items?.length ?? 0) > 0 && (
          <Panel title="الوارد والمنصرف حسب البند" hint="نفس مصادر «الصافي»؛ اضغط على «الصافي» أعلاه لدفتر الحركات الكامل"
            actions={<ExportButton onClick={() => exportRows('الوارد_والمنصرف', 'البنود', (metrics.cash_items ?? []).map(c => ({ 'البند': c.label, 'النوع': c.direction === 'in' ? 'وارد' : 'منصرف', 'المبلغ': c.amount })))} />}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead className="bg-gray-50 text-gray-600"><tr><th className="text-right px-3 py-2 font-semibold">البند</th><th className="text-right px-3 py-2 font-semibold">النوع</th><th className="text-center px-3 py-2 font-semibold">المبلغ</th></tr></thead>
                <tbody>
                  {(metrics.cash_items ?? []).map(c => (
                    <tr key={c.key} className="border-t border-gray-100"><td className="px-3 py-2">{c.label}</td>
                      <td className={`px-3 py-2 ${c.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{c.direction === 'in' ? 'وارد' : 'منصرف'}</td>
                      <td className={`px-3 py-2 text-center font-bold ${c.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(c.amount)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 bg-gray-50 font-bold"><td className="px-3 py-2" colSpan={2}>الصافي</td><td className="px-3 py-2 text-center">{fmt(metrics.net_profit)}</td></tr></tfoot>
              </table>
            </div>
          </Panel>
        )}
        </>}

        {activeTab === 'sales' && <>
          <SalesReportsTab />
        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-base font-bold text-gray-800 mb-4">المبيعات حسب المسوق</h3>
            <div className="h-64">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={5} dataKey="value" label={({ name, value }) => `${name}: ${value.toLocaleString('ar-EG')}`}>
                      {pieData.map((_e, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-full text-gray-400">لا توجد بيانات</div>}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-base font-bold text-gray-800 mb-4">حالة الأوردرات</h3>
            <div className="h-64">
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} barSize={60}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-full text-gray-400">لا توجد بيانات</div>}
            </div>
          </div>
        </div>
        </>}

        {activeTab === 'inventory' && <InventoryReportsTab metrics={metrics} />}
        {activeTab === 'production' && <ProductionTab metrics={metrics} />}
        {activeTab === 'collections' && <DelayedCollectionsTab dashboardReceivable={metrics.shipping_receivable} />}
        </div>
      </>}
    </div>
  );
}

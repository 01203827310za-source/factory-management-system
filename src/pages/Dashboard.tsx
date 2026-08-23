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

type CategoryKey = 'fabric' | 'stock' | 'accessories' | 'cutting' | 'wip' | 'receivables';

const PAGE_SIZE = 10;

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);
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
  const barData = Object.entries(metrics.order_status_counts).map(([name, value]) => ({ name, value }));

  const assetBreakdown: { key: CategoryKey; label: string; val: number }[] = [
    { key: 'fabric', label: 'القماش المتاح × التكلفة', val: metrics.fabric_value },
    { key: 'stock', label: 'الاستوك المتاح × التكلفة', val: metrics.stock_value },
    { key: 'accessories', label: 'الإكسسوارات × التكلفة', val: metrics.accessories_value },
    { key: 'cutting', label: 'قطع متبقية × تكلفة المتر', val: metrics.cutting_value },
    { key: 'wip', label: 'قيمة التشغيل (قيد التشغيل)', val: metrics.wip_value },
    { key: 'receivables', label: 'الفلوس اللي لنا برا (حسابات العملاء)', val: metrics.money_owed_to_us },
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
    if (detailCategory === 'receivables') {
      const rows = metrics.receivable_items
        .filter(i => !q || i.name.toLowerCase().includes(q) || i.reference.toLowerCase().includes(q))
        .sort((a, b) => sortNum(a.remaining, b.remaining));
      return { rows, total: metrics.money_owed_to_us };
    }
    return { rows: [] as never[], total: 0 };
  }, [detailCategory, metrics, search, sortDesc]);

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
        {/* Top Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="إجمالي المبيعات" value={metrics.total_sales} icon={<ShoppingCart size={22} />} color="blue" />
          <StatCard title="إجمالي المصاريف" value={metrics.total_expenses} icon={<TrendingDown size={22} />} color="red" />
          <StatCard title="صافي الربح" value={metrics.net_profit} icon={metrics.net_profit >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />} color={metrics.net_profit >= 0 ? 'green' : 'red'} />
          <StatCard title="المتبقي من الديون" value={metrics.remaining_debts} icon={<AlertTriangle size={22} />} color="yellow" alert={metrics.remaining_debts > 0} />
        </div>

        {/* Reservations Banner */}
        {metrics.total_reservations > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-orange-700">🔖 الحجوزات النشطة</span>
            <span className="text-lg font-bold text-orange-700">إجمالي الحجوزات: {metrics.total_reservations.toLocaleString('ar-EG')}</span>
          </div>
        )}

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
                    {metrics.net_profit.toLocaleString('ar-EG')}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="الكاش المتاح" value={metrics.cash_available} subtitle="الوارد الكلي − الديون − المصاريف" icon={<Wallet size={22} />} color={metrics.cash_available >= 0 ? 'green' : 'red'} />
          <StatCard title="الفلوس اللي لنا برا" value={metrics.money_owed_to_us} subtitle="مبيعات غير مصروفة + حسابات عملاء" icon={<DollarSign size={22} />} color="purple" alert={metrics.money_owed_to_us > 0} />
          <StatCard title="المتبقي من الديون" value={metrics.remaining_debts} subtitle="المستحقات علينا" icon={<AlertTriangle size={22} />} color="yellow" alert={metrics.remaining_debts > 0} />
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(pagedRows as DashboardMetrics['receivable_items']).map((it, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-gray-800">{it.name}</td>
                          <td className="px-3 py-2 text-gray-600">{it.source === 'sale' ? 'أوردر مبيعات' : 'حساب عميل'}</td>
                          <td className="px-3 py-2 text-gray-600">{it.reference || '—'}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.invoice_total)}</td>
                          <td className="px-3 py-2 text-gray-600">{fmt(it.paid)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(it.remaining)}</td>
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

        {/* Profit by Period */}
        <ProfitByPeriod />

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
    </div>
  );
}

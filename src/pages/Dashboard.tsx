import { useState, useEffect } from 'react';
import StatCard from '../components/StatCard';
import { getDashboardMetrics } from '../data/store';
import type { DashboardMetrics } from '../types';
import {
  TrendingUp, TrendingDown, Wallet, AlertTriangle,
  Users, DollarSign, ShoppingCart, ArrowLeftRight, RefreshCw
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import ProfitByPeriod from '../components/ProfitByPeriod';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const EMPTY: DashboardMetrics = {
  total_sales: 0, total_expenses: 0, net_profit: 0, remaining_debts: 0,
  hatem_total_in: 0, hatem_total_out: 0, hatem_net: 0,
  mido_total_in: 0, mido_total_out: 0, mido_net: 0,
  total_in: 0, total_out: 0, cash_available: 0, money_owed_to_us: 0,
  sales_by_marketer: {}, order_status_counts: {}, total_returns: 0, total_refunds: 0,
  total_current_assets: 0, fabric_value: 0, stock_value: 0, accessories_value: 0,
  total_reservations: 0,
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);

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

        {/* Partners Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Users size={20} className="text-blue-600" /> ملخص الشركاء
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-right px-6 py-3 font-semibold text-gray-600">الشريك</th>
                  <th className="text-center px-6 py-3 font-semibold text-gray-600">إجمالي الوارد</th>
                  <th className="text-center px-6 py-3 font-semibold text-gray-600">إجمالي المصاريف</th>
                  <th className="text-center px-6 py-3 font-semibold text-gray-600">الصافي المتاح</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'محمد (ميدو)', inn: metrics.mido_total_in, out: metrics.mido_total_out, net: metrics.mido_net },
                  { name: 'حاتم', inn: metrics.hatem_total_in, out: metrics.hatem_total_out, net: metrics.hatem_net },
                ].map(p => (
                  <tr key={p.name} className="border-t border-gray-50 hover:bg-blue-50/50">
                    <td className="px-6 py-4 font-medium">{p.name}</td>
                    <td className="px-6 py-4 text-center text-emerald-600 font-semibold">{p.inn.toLocaleString('ar-EG')}</td>
                    <td className="px-6 py-4 text-center text-red-600 font-semibold">{p.out.toLocaleString('ar-EG')}</td>
                    <td className={`px-6 py-4 text-center font-bold ${p.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{p.net.toLocaleString('ar-EG')}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-6 py-4">الإجمالي</td>
                  <td className="px-6 py-4 text-center text-emerald-700">{metrics.total_in.toLocaleString('ar-EG')}</td>
                  <td className="px-6 py-4 text-center text-red-700">{metrics.total_out.toLocaleString('ar-EG')}</td>
                  <td className={`px-6 py-4 text-center ${metrics.net_profit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{metrics.net_profit.toLocaleString('ar-EG')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 bg-orange-50 border-t border-orange-100 text-xs text-orange-700 flex items-center gap-2">
            <ArrowLeftRight size={14} /> ملاحظة: العربون يُحسب للشريك الذي استلمه، والمتبقي من الأوردرات "تم الصرف" يُضاف لحساب حاتم
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'القماش المتاح × التكلفة', val: metrics.fabric_value },
              { label: 'الاستوك المتاح × التكلفة', val: metrics.stock_value },
              { label: 'الإكسسوارات × التكلفة', val: metrics.accessories_value },
              { label: 'الفلوس اللي لنا برا', val: metrics.money_owed_to_us },
            ].map(item => (
              <div key={item.label} className="bg-white/10 rounded-lg p-3">
                <p className="text-xs text-white/70">{item.label}</p>
                <p className="text-lg font-bold">{item.val.toLocaleString('ar-EG')}</p>
              </div>
            ))}
          </div>
          <div className="bg-white/10 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-white/70">الصافي مع ميدو وحاتم بعد الديون</p>
              <p className="text-sm text-white/70">(صافي ميدو + صافي حاتم − الديون)</p>
            </div>
            <div className="text-left">
              <p className="text-xs text-white/50">المجموع الكلي</p>
              <p className={`text-2xl font-bold ${metrics.total_current_assets >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                {metrics.total_current_assets.toLocaleString('ar-EG')}
              </p>
            </div>
          </div>
        </div>

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

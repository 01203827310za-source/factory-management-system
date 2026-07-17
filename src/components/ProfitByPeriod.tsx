import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Calendar, Minus } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { snapshotsApi, type SnapshotRecord, type ProfitResult } from '../services/api';

// ── Period definitions ────────────────────────────────────────────
type PeriodKey =
  | 'today' | 'yesterday'
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'this_year' | 'custom';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today',       label: 'اليوم' },
  { key: 'yesterday',   label: 'أمس' },
  { key: 'this_week',   label: 'هذا الأسبوع' },
  { key: 'last_week',   label: 'الأسبوع الماضي' },
  { key: 'this_month',  label: 'هذا الشهر' },
  { key: 'last_month',  label: 'الشهر الماضي' },
  { key: 'this_year',   label: 'هذا العام' },
  { key: 'custom',      label: 'مخصص' },
];

// ── Date-range calculator ─────────────────────────────────────────
function getPeriodDates(period: PeriodKey, customFrom = '', customTo = '') {
  if (period === 'custom') return { from_date: customFrom, to_date: customTo };

  const local = new Date();
  const today = new Date(local.getFullYear(), local.getMonth(), local.getDate());

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const shift = (d: Date, n: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  switch (period) {
    case 'today':
      // start = end of yesterday; end = live now
      return { from_date: fmt(shift(today, -1)), to_date: fmt(today) };

    case 'yesterday': {
      const yest = shift(today, -1);
      return { from_date: fmt(shift(today, -2)), to_date: fmt(yest) };
    }

    case 'this_week': {
      const dow       = today.getDay(); // 0=Sun
      const dToMon    = dow === 0 ? 6 : dow - 1;
      const monday    = shift(today, -dToMon);
      return { from_date: fmt(shift(monday, -1)), to_date: fmt(today) };
    }

    case 'last_week': {
      const dow       = today.getDay();
      const dToMon    = dow === 0 ? 6 : dow - 1;
      const thisMon   = shift(today, -dToMon);
      const lastSun   = shift(thisMon, -1);   // end of last week
      const lastMon   = shift(thisMon, -7);   // start of last week
      return { from_date: fmt(shift(lastMon, -1)), to_date: fmt(lastSun) };
    }

    case 'this_month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from_date: fmt(shift(first, -1)), to_date: fmt(today) };
    }

    case 'last_month': {
      const firstThis  = new Date(today.getFullYear(), today.getMonth(), 1);
      const lastOfLast = shift(firstThis, -1);
      const firstLast  = new Date(lastOfLast.getFullYear(), lastOfLast.getMonth(), 1);
      return { from_date: fmt(shift(firstLast, -1)), to_date: fmt(lastOfLast) };
    }

    case 'this_year': {
      const jan1 = new Date(today.getFullYear(), 0, 1);
      return { from_date: fmt(shift(jan1, -1)), to_date: fmt(today) };
    }

    default:
      return { from_date: fmt(today), to_date: fmt(today) };
  }
}

// ── Formatters ────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
const fmtDate = (d: string) => {
  const [, m, day] = d.split('-');
  return `${parseInt(day)}/${parseInt(m)}`;
};

// ── Sub-components ────────────────────────────────────────────────
function MetricBox({
  label, value, sub, positive, neutral,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  neutral?: boolean;
}) {
  const color = neutral
    ? 'text-gray-800'
    : positive
    ? 'text-emerald-600'
    : 'text-red-500';

  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function ProfitByPeriod() {
  const [period, setPeriod]         = useState<PeriodKey>('this_month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');

  const [profitData, setProfitData]   = useState<ProfitResult | null>(null);
  const [chartData,  setChartData]    = useState<SnapshotRecord[]>([]);
  const [loading,    setLoading]      = useState(false);
  const [snapBusy,   setSnapBusy]     = useState(false);
  const [error,      setError]        = useState('');

  // Fetch the historical chart once + whenever snapshots change
  const loadChart = useCallback(async () => {
    try {
      const data = await snapshotsApi.getAll();
      setChartData(data);
    } catch {
      // chart failing silently is acceptable
    }
  }, []);

  // Fetch profit for selected period
  const loadProfit = useCallback(async (p: PeriodKey, cf = customFrom, ct = customTo) => {
    const { from_date, to_date } = getPeriodDates(p, cf, ct);
    if (!from_date || !to_date) return;

    setLoading(true);
    setError('');
    try {
      const result = await snapshotsApi.getProfit(from_date, to_date);
      setProfitData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [customFrom, customTo]);

  // On period change (non-custom) fetch immediately
  useEffect(() => {
    loadChart();
    if (period !== 'custom') loadProfit(period);
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // Manual snapshot refresh
  const takeSnapshot = async () => {
    setSnapBusy(true);
    try {
      await snapshotsApi.take();
      await loadChart();
      if (period !== 'custom') await loadProfit(period);
    } finally {
      setSnapBusy(false);
    }
  };

  // Derived display values
  const profit    = profitData?.profit        ?? 0;
  const growth    = profitData?.growth_percent ?? null;
  const isPositive = profit >= 0;

  // Chart Y-axis: nice rounded min/max
  const allValues = chartData.map(s => s.total_current_assets);
  const yMin = allValues.length ? Math.floor(Math.min(...allValues) * 0.97) : 0;
  const yMax = allValues.length ? Math.ceil(Math.max(...allValues)  * 1.03) : 100;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden" dir="rtl">

      {/* ── Header ── */}
      <div className="bg-gradient-to-l from-[#1e3a5f] to-[#2d5a8e] px-6 py-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <TrendingUp size={20} /> الربح حسب الفترة
        </h2>
        <button
          onClick={takeSnapshot}
          disabled={snapBusy}
          title="تحديث لقطة اليوم"
          className="flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={snapBusy ? 'animate-spin' : ''} />
          تحديث اللقطة
        </button>
      </div>

      {/* ── Period selector ── */}
      <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              period === p.key
                ? 'bg-[#1e3a5f] text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Custom date range ── */}
      {period === 'custom' && (
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <Calendar size={15} className="text-gray-400 flex-shrink-0" />
          <label className="text-xs text-gray-500">من</label>
          <input
            type="date"
            value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          />
          <label className="text-xs text-gray-500">إلى</label>
          <input
            type="date"
            value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          />
          <button
            onClick={() => loadProfit('custom', customFrom, customTo)}
            disabled={!customFrom || !customTo || loading}
            className="bg-[#1e3a5f] text-white px-4 py-1.5 rounded-lg text-xs hover:bg-[#16304d] transition disabled:opacity-50"
          >
            احسب
          </button>
        </div>
      )}

      <div className="px-6 py-5 space-y-6">

        {/* ── Loading / Error / No data ── */}
        {loading && (
          <div className="flex items-center justify-center h-24 text-gray-400 text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> جارٍ الحساب...
          </div>
        )}

        {!loading && error && (
          <div className="text-center text-sm text-red-500 py-4">{error}</div>
        )}

        {!loading && !error && !profitData && period !== 'custom' && (
          <div className="text-center text-sm text-gray-400 py-4">
            اختر فترة لعرض الربح
          </div>
        )}

        {/* ── Profit summary ── */}
        {!loading && !error && profitData && (
          <>
            {/* No baseline warning */}
            {!profitData.has_start_data && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
                لا توجد لقطة لبداية الفترة — ستظهر البيانات بعد يوم من تسجيل أول لقطة.
                قم بتحميل لوحة التحكم يومياً لبناء السجل التاريخي.
              </div>
            )}

            {/* 4 metric boxes */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricBox
                label="أصول البداية"
                value={fmt(profitData.start_assets)}
                sub={profitData.has_start_data ? profitData.start_date : '—'}
                neutral
              />
              <MetricBox
                label="أصول النهاية"
                value={fmt(profitData.end_assets)}
                sub={profitData.end_date}
                neutral
              />
              <MetricBox
                label="صافي الربح / الخسارة"
                value={`${isPositive ? '+' : ''}${fmt(profit)}`}
                sub={isPositive ? 'ربح' : 'خسارة'}
                positive={isPositive}
              />
              <MetricBox
                label="نسبة النمو"
                value={
                  growth !== null
                    ? `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`
                    : '—'
                }
                sub={growth !== null ? (growth >= 0 ? 'نمو إيجابي' : 'تراجع') : 'لا توجد بيانات بداية'}
                positive={growth !== null && growth >= 0}
                neutral={growth === null}
              />
            </div>

            {/* Profit visual indicator */}
            <div
              className={`rounded-xl p-4 flex items-center justify-between ${
                isPositive
                  ? 'bg-emerald-50 border border-emerald-200'
                  : profit === 0
                  ? 'bg-gray-50 border border-gray-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {isPositive && profit !== 0 ? (
                  <TrendingUp size={24} className="text-emerald-600" />
                ) : profit === 0 ? (
                  <Minus size={24} className="text-gray-500" />
                ) : (
                  <TrendingDown size={24} className="text-red-500" />
                )}
                <div>
                  <p className={`text-sm font-semibold ${
                    isPositive && profit !== 0 ? 'text-emerald-700'
                    : profit === 0            ? 'text-gray-600'
                    : 'text-red-600'
                  }`}>
                    {isPositive && profit !== 0
                      ? 'الشركة في نمو خلال هذه الفترة'
                      : profit === 0
                      ? 'لا يوجد تغيير في الأصول'
                      : 'تراجع في إجمالي الأصول خلال هذه الفترة'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    الربح = أصول النهاية − أصول البداية
                  </p>
                </div>
              </div>
              <span className={`text-2xl font-bold ${
                isPositive && profit !== 0 ? 'text-emerald-600'
                : profit === 0            ? 'text-gray-600'
                : 'text-red-500'
              }`}>
                {isPositive ? '+' : ''}{fmt(profit)}
              </span>
            </div>
          </>
        )}

        {/* ── Line chart: Total Current Assets history ── */}
        {chartData.length >= 2 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <TrendingUp size={15} className="text-blue-500" />
              إجمالي الأصول الحالية عبر الزمن
              <span className="text-xs font-normal text-gray-400">
                ({chartData.length} لقطة)
              </span>
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="snapshot_date"
                    tickFormatter={fmtDate}
                    fontSize={11}
                    tick={{ fill: '#6b7280' }}
                    interval={Math.max(0, Math.ceil(chartData.length / 10) - 1)}
                  />
                  <YAxis
                    domain={[yMin, yMax]}
                    tickFormatter={v => (v / 1000).toFixed(0) + 'k'}
                    fontSize={11}
                    tick={{ fill: '#6b7280' }}
                    width={42}
                  />
                  <Tooltip
                    formatter={(v: unknown) => [fmt(Number(v ?? 0)), 'إجمالي الأصول']}
                    labelFormatter={(label: unknown) => `تاريخ: ${label}`}
                    contentStyle={{ fontSize: 12, direction: 'rtl', fontFamily: 'inherit' }}
                  />
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                  <Line
                    type="monotone"
                    dataKey="total_current_assets"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={chartData.length <= 30}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {chartData.length === 1 && (
          <p className="text-xs text-center text-gray-400 py-2">
            لقطة واحدة مسجلة — يظهر الرسم البياني بعد يومين أو أكثر
          </p>
        )}

        {chartData.length === 0 && (
          <p className="text-xs text-center text-gray-400 py-2">
            لم يتم إنشاء أي لقطات بعد — افتح لوحة التحكم لإنشاء أول لقطة تلقائياً
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================
// Audit Log Page — سجل التعديلات
// Read-only: filters, table, before/after diff
// ============================================

import { useState, useEffect } from 'react';
import { Search, Eye, Download, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { auditLogApi, type AuditLogRecord } from '../services/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import * as XLSX from 'xlsx';

// ─── Helpers ───────────────────────────────
const MODULES = [
  'Sales','Reservations','Debts','Client Accounts','Expenses & Revenues',
  'Ready Stock','Fabric Warehouse','Fabric Purchases','Accessories Warehouse',
  'Cutting','Reports','Financial Center','Fixed Assets','Payroll',
];

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  CREATE: { label: 'إضافة',  color: 'bg-green-100 text-green-700' },
  UPDATE: { label: 'تعديل',  color: 'bg-blue-100 text-blue-700'   },
  DELETE: { label: 'حذف',    color: 'bg-red-100 text-red-700'     },
};

function fmtDatetime(ts: string) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    time: d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

// ─── Diff renderer ──────────────────────────
function DiffView({ before, after }: { before: string | null; after: string | null }) {
  let beforeObj: Record<string, unknown> = {};
  let afterObj:  Record<string, unknown> = {};
  try { if (before) beforeObj = JSON.parse(before); } catch { /* ignore */ }
  try { if (after)  afterObj  = JSON.parse(after);  } catch { /* ignore */ }

  const allKeys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])];

  if (allKeys.length === 0) {
    return <p className="text-gray-400 text-sm text-center py-4">لا توجد بيانات</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="border border-gray-200 px-3 py-2 text-right font-medium text-gray-600 w-1/3">الحقل</th>
            <th className="border border-gray-200 px-3 py-2 text-right font-medium text-red-600 w-1/3">القيمة القديمة</th>
            <th className="border border-gray-200 px-3 py-2 text-right font-medium text-green-600 w-1/3">القيمة الجديدة</th>
          </tr>
        </thead>
        <tbody>
          {allKeys.map(key => {
            const bv = beforeObj[key];
            const av = afterObj[key];
            const changed = JSON.stringify(bv) !== JSON.stringify(av);
            const bStr = bv !== undefined ? String(bv) : '—';
            const aStr = av !== undefined ? String(av) : '—';
            return (
              <tr key={key} className={changed ? 'bg-yellow-50' : ''}>
                <td className="border border-gray-200 px-3 py-2 font-mono text-xs text-gray-500">{key}</td>
                <td className={`border border-gray-200 px-3 py-2 ${changed ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                  {bStr}
                </td>
                <td className={`border border-gray-200 px-3 py-2 ${changed ? 'text-green-700 font-medium' : 'text-gray-600'}`}>
                  {aStr}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
const PAGE_SIZE = 50;

export default function AuditLog() {
  const toast = useToast();

  // Filters
  const [fromDate, setFromDate]   = useState('');
  const [toDate, setToDate]       = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [page, setPage]           = useState(1);

  // Data
  const [logs, setLogs]     = useState<AuditLogRecord[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(false);

  // Detail modal
  const [detail, setDetail] = useState<AuditLogRecord | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const loadLogs = async (p = page) => {
    setLoading(true);
    try {
      const res = await auditLogApi.getLogs({
        from_date:  fromDate   || undefined,
        to_date:    toDate     || undefined,
        user_name:  filterUser || undefined,
        module:     filterModule || undefined,
        action:     filterAction || undefined,
        page: p,
        limit: PAGE_SIZE,
      });
      setLogs(res.logs);
      setTotal(res.total);
    } catch {
      toast('error', 'خطأ في جلب سجل التعديلات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadLogs(1); setPage(1); }, [fromDate, toDate, filterModule, filterAction]);
  useEffect(() => { loadLogs(page); }, [page]);

  const handleSearch = () => { setPage(1); loadLogs(1); };

  // ── Export ──
  const exportExcel = () => {
    const rows = logs.map(l => {
      const { date, time } = fmtDatetime(l.timestamp);
      return {
        'التاريخ':    date,
        'الوقت':      time,
        'المستخدم':   l.user_name,
        'الوحدة':     l.module,
        'الإجراء':    ACTION_LABELS[l.action]?.label ?? l.action,
        'رقم السجل':  l.record_id,
        'الوصف':      l.description,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجل التعديلات');
    XLSX.writeFile(wb, `سجل_التعديلات_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const printLog = () => {
    const rows = logs.map(l => {
      const { date, time } = fmtDatetime(l.timestamp);
      return `<tr>
        <td>${date}</td><td>${time}</td><td>${l.user_name}</td>
        <td>${l.module}</td><td>${ACTION_LABELS[l.action]?.label ?? l.action}</td>
        <td>${l.description}</td>
      </tr>`;
    }).join('');
    const html = `<html dir="rtl"><head><meta charset="utf-8"/><title>سجل التعديلات</title>
    <style>body{font-family:Arial;padding:20px;font-size:12px}h2{text-align:center}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px;text-align:right}
    th{background:#1e3a5f;color:white}</style></head><body>
    <h2>سجل التعديلات</h2>
    <table><thead><tr><th>التاريخ</th><th>الوقت</th><th>المستخدم</th><th>الوحدة</th><th>الإجراء</th><th>الوصف</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 400);
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">سجل التعديلات</h1>
          <p className="text-sm text-gray-500 mt-1">سجل شامل لجميع العمليات — قراءة فقط</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel}
            className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-xl hover:bg-emerald-700 transition text-sm">
            <Download size={15}/> Excel
          </button>
          <button onClick={printLog}
            className="flex items-center gap-2 bg-gray-600 text-white px-3 py-2 rounded-xl hover:bg-gray-700 transition text-sm">
            <Printer size={15}/> طباعة
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">من تاريخ</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">إلى تاريخ</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">المستخدم</label>
            <div className="relative">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input value={filterUser} onChange={e => setFilterUser(e.target.value)} placeholder="اسم المستخدم..."
                className="pr-9 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-40"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">الوحدة</label>
            <select value={filterModule} onChange={e => setFilterModule(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              <option value="">الكل</option>
              {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">نوع الإجراء</label>
            <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              <option value="">الكل</option>
              <option value="CREATE">إضافة</option>
              <option value="UPDATE">تعديل</option>
              <option value="DELETE">حذف</option>
            </select>
          </div>
          <button onClick={handleSearch}
            className="bg-[#1e3a5f] text-white px-4 py-2 rounded-xl hover:bg-[#16304d] transition text-sm font-medium">
            بحث
          </button>
          <button onClick={() => { setFromDate(''); setToDate(''); setFilterUser(''); setFilterModule(''); setFilterAction(''); setPage(1); }}
            className="border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition text-sm text-gray-600">
            مسح الفلاتر
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>إجمالي السجلات: <strong className="text-gray-800">{total.toLocaleString('ar-EG')}</strong></span>
        <span>الصفحة {page} من {totalPages}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white">
              <tr>{['التاريخ','الوقت','المستخدم','الوحدة','الإجراء','الوصف','التفاصيل'].map(h => (
                <th key={h} className="px-4 py-3 text-right font-medium whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">جارٍ التحميل...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">لا توجد سجلات مطابقة</td></tr>
              ) : logs.map((log, i) => {
                const { date, time } = fmtDatetime(log.timestamp);
                const act = ACTION_LABELS[log.action] ?? { label: log.action, color: 'bg-gray-100 text-gray-700' };
                return (
                  <tr key={log.id} className={i % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50 hover:bg-gray-100'}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{date}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500 text-xs">{time}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{log.user_name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{log.module}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${act.color}`}>{act.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-xs truncate">{log.description}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setDetail(log)}
                        className="flex items-center gap-1 text-[#1e3a5f] hover:bg-blue-50 px-2 py-1 rounded-lg transition text-xs font-medium">
                        <Eye size={14}/> عرض التفاصيل
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition">
              <ChevronRight size={15}/> السابق
            </button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + idx;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm transition ${p === page ? 'bg-[#1e3a5f] text-white' : 'hover:bg-gray-100'}`}>
                    {p}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm disabled:opacity-40 hover:bg-gray-50 transition">
              التالي <ChevronLeft size={15}/>
            </button>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title="تفاصيل التعديل">
        {detail && (
          <div className="space-y-4 p-1">
            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['المستخدم', detail.user_name],
                ['الوحدة',   detail.module],
                ['الإجراء',  ACTION_LABELS[detail.action]?.label ?? detail.action],
                ['رقم السجل', detail.record_id],
                ['التاريخ والوقت', `${fmtDatetime(detail.timestamp).date} ${fmtDatetime(detail.timestamp).time}`],
                ['الوصف', detail.description],
              ].map(([k, v]) => (
                <div key={k} className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">{k}</p>
                  <p className="font-medium text-gray-800 mt-0.5">{v}</p>
                </div>
              ))}
            </div>

            {/* Diff */}
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">مقارنة البيانات</h4>
              <p className="text-xs text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2 mb-3">
                الحقول الملوّنة بالأصفر تعني أن القيمة تغيّرت
              </p>
              <DiffView before={detail.before_data} after={detail.after_data} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

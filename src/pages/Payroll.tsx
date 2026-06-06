// ============================================
// Payroll Page — المرتبات
// 7 tabs: Employees | Production | Advances
//         Deductions | Bonuses | Payroll | Reports
// ============================================

import { useState, useEffect } from 'react';
import {
  Users, Factory, TrendingDown, Award, FileText, BarChart2,
  Plus, Edit2, Trash2, Printer, Download, Search, X,
} from 'lucide-react';
import {
  payrollApi,
  type EmployeeRecord,
  type PieceRateRecord,
  type ProductionRecord,
  type AdvanceRecord,
  type DeductionRecord,
  type BonusRecord,
  type SalaryRow,
  type PayrollReportData,
} from '../services/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import * as XLSX from 'xlsx';

// ─── constants ───────────────────────────────
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const CY = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CY - 2 + i);
const TODAY = new Date().toISOString().slice(0, 10);

// ─── helpers ─────────────────────────────────
const fmt = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

type Tab = 'employees' | 'production' | 'advances' | 'deductions' | 'bonuses' | 'payroll' | 'reports';

// ─── shared month/year bar ────────────────────
function MonthYearBar({ month, year, setMonth, setYear }: { month: number; year: number; setMonth: (m: number) => void; setYear: (y: number) => void }) {
  return (
    <div className="flex gap-2">
      <select value={month} onChange={e => setMonth(+e.target.value)}
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <select value={year} onChange={e => setYear(+e.target.value)}
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
        {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

// ─── shared employee dropdown ─────────────────
function EmpSelect({ employees, value, onChange, placeholder = 'كل الموظفين', includeAll = false }: {
  employees: EmployeeRecord[]; value: string; onChange: (v: string) => void;
  placeholder?: string; includeAll?: boolean;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
      {includeAll && <option value="">{placeholder}</option>}
      {employees.map(e => (
        <option key={e.id} value={e.id}>{e.employee_name}</option>
      ))}
    </select>
  );
}

// ─── table header ─────────────────────────────
function TH({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`px-3 py-3 text-${center ? 'center' : 'right'} font-medium whitespace-nowrap`}>{children}</th>;
}

// ─── summary card ─────────────────────────────
function SumCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    blue:   'from-blue-600 to-blue-800',
    green:  'from-emerald-600 to-emerald-800',
    red:    'from-red-600 to-red-800',
    orange: 'from-orange-500 to-orange-700',
    purple: 'from-purple-600 to-purple-800',
    teal:   'from-teal-600 to-teal-800',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color] ?? colors.blue} text-white rounded-2xl p-4 shadow`}>
      <p className="text-xs text-white/70 mb-1">{label}</p>
      <p className="text-xl font-bold">{fmt(value)}</p>
      <p className="text-xs text-white/50">ج.م</p>
    </div>
  );
}

// ─── delete confirm modal ─────────────────────
function DeleteConfirm({ open, onConfirm, onCancel, msg = 'هل أنت متأكد من الحذف؟' }: {
  open: boolean; onConfirm: () => void; onCancel: () => void; msg?: string;
}) {
  return (
    <Modal isOpen={open} onClose={onCancel} title="تأكيد الحذف">
      <div className="space-y-4 p-1">
        <p className="text-gray-700">{msg}</p>
        <div className="flex gap-3">
          <button onClick={onConfirm} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 transition">حذف</button>
          <button onClick={onCancel} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
        </div>
      </div>
    </Modal>
  );
}

// ==============================================
// EMPLOYEE FORM
// ==============================================
type RateRow = { id?: number; category_name: string; piece_rate: number };
const EMPTY_EMP_FORM = {
  employee_code: '', employee_name: '', department: '', job_title: '',
  employee_type: 'fixed' as 'fixed' | 'piecework', base_salary: 0,
  status: 'active' as 'active' | 'inactive', notes: '',
};

function EmployeeForm({ initial, initialRates, onSave, onCancel, saving }: {
  initial: typeof EMPTY_EMP_FORM; initialRates: RateRow[];
  onSave: (f: typeof EMPTY_EMP_FORM, rates: RateRow[]) => void;
  onCancel: () => void; saving: boolean;
}) {
  const [f, setF]   = useState(initial);
  const [rates, setRates] = useState<RateRow[]>(initialRates);

  const upd = <K extends keyof typeof f>(k: K, v: typeof f[K]) => setF(p => ({ ...p, [k]: v }));
  const addRate   = () => setRates(p => [...p, { category_name: '', piece_rate: 0 }]);
  const delRate   = (i: number) => setRates(p => p.filter((_, idx) => idx !== i));
  const setRate   = (i: number, k: keyof RateRow, v: string | number) =>
    setRates(p => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const inp = (label: string, k: keyof typeof f, type = 'text') => (
    <div key={k}>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} value={String(f[k])}
        onChange={e => upd(k, (type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value) as typeof f[K])}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
    </div>
  );

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-3">
        {inp('كود الموظف *', 'employee_code')}
        {inp('اسم الموظف *', 'employee_name')}
        {inp('الإدارة', 'department')}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">نوع الموظف</label>
          <select value={f.employee_type} onChange={e => upd('employee_type', e.target.value as 'fixed' | 'piecework')}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
            <option value="fixed">راتب ثابت</option>
            <option value="piecework">بالقطعة</option>
          </select>
        </div>
        {inp('المسمى الوظيفي', 'job_title')}
        {f.employee_type === 'fixed' && inp('الراتب الأساسي', 'base_salary', 'number')}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">الحالة</label>
          <select value={f.status} onChange={e => upd('status', e.target.value as 'active' | 'inactive')}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>
        <div className="col-span-2">{inp('ملاحظات', 'notes')}</div>
      </div>

      {f.employee_type === 'piecework' && (
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <div className="flex justify-between items-center">
            <h4 className="text-sm font-semibold text-gray-700">فئات الإنتاج</h4>
            <button type="button" onClick={addRate}
              className="flex items-center gap-1 text-xs bg-[#1e3a5f] text-white px-2.5 py-1 rounded-lg hover:bg-[#16304d]">
              <Plus size={12}/> إضافة فئة
            </button>
          </div>
          {rates.length === 0 && <p className="text-xs text-gray-400 text-center py-2">لا توجد فئات — أضف فئة</p>}
          {rates.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input placeholder="اسم الفئة" value={r.category_name}
                onChange={e => setRate(i, 'category_name', e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
              <input type="number" min="0" step="0.01" placeholder="السعر" value={r.piece_rate}
                onChange={e => setRate(i, 'piece_rate', parseFloat(e.target.value) || 0)}
                className="w-28 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
              <span className="text-xs text-gray-400">ج.م</span>
              <button type="button" onClick={() => delRate(i)}
                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><X size={13}/></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => onSave(f, rates)} disabled={saving}
          className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60 text-sm font-medium">
          {saving ? 'جارٍ الحفظ...' : 'حفظ'}
        </button>
        <button onClick={onCancel} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 text-sm">إلغاء</button>
      </div>
    </div>
  );
}

// ==============================================
// EMPLOYEES TAB
// ==============================================
function EmployeesTab({ employees, loading, reload }: {
  employees: EmployeeRecord[]; loading: boolean; reload: () => void;
}) {
  const toast = useToast();
  const [search, setSearch]       = useState('');
  const [modal, setModal]         = useState<'add' | 'edit' | null>(null);
  const [editEmp, setEditEmp]     = useState<EmployeeRecord | null>(null);
  const [saving, setSaving]       = useState(false);
  const [delId, setDelId]         = useState<number | null>(null);

  const filtered = employees.filter(e =>
    !search || e.employee_name.includes(search) || e.employee_code.includes(search));

  const handleSave = async (f: typeof EMPTY_EMP_FORM, rates: RateRow[]) => {
    if (!f.employee_code.trim() || !f.employee_name.trim()) { toast('error', 'كود الموظف والاسم مطلوبان'); return; }
    setSaving(true);
    try {
      const payload = { ...f, piece_rates: f.employee_type === 'piecework' ? rates : [] };
      if (modal === 'add') {
        await payrollApi.addEmployee(payload);
        toast('success', 'تم إضافة الموظف');
      } else if (editEmp) {
        await payrollApi.updateEmployee(editEmp.id, payload);
        toast('success', 'تم تعديل الموظف');
      }
      setModal(null); setEditEmp(null); reload();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    if (!delId) return;
    try { await payrollApi.removeEmployee(delId); toast('success', 'تم الحذف'); reload(); }
    catch { toast('error', 'خطأ في الحذف'); }
    finally { setDelId(null); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(e => ({
      'الكود': e.employee_code, 'الاسم': e.employee_name, 'الإدارة': e.department,
      'النوع': e.employee_type === 'fixed' ? 'راتب ثابت' : 'بالقطعة',
      'الراتب الأساسي': e.base_salary, 'الحالة': e.status === 'active' ? 'نشط' : 'غير نشط',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الموظفون');
    XLSX.writeFile(wb, 'الموظفون.xlsx');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div className="relative">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
            className="pr-9 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-52"/>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700">
            <Download size={14}/> Excel
          </button>
          <button onClick={() => { setModal('add'); setEditEmp(null); }}
            className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#16304d]">
            <Plus size={16}/> إضافة موظف
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr><TH>الكود</TH><TH>الاسم</TH><TH>الإدارة</TH><TH>النوع</TH><TH>الراتب / فئات الإنتاج</TH><TH>الحالة</TH><TH>إجراءات</TH></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">جارٍ التحميل...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">لا يوجد موظفون</td></tr>
              ) : filtered.map((emp, i) => (
                <tr key={emp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 font-mono text-xs">{emp.employee_code}</td>
                  <td className="px-3 py-2.5 font-medium">{emp.employee_name}</td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{emp.department}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${emp.employee_type === 'fixed' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                      {emp.employee_type === 'fixed' ? 'راتب ثابت' : 'بالقطعة'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {emp.employee_type === 'fixed' ? (
                      <span className="font-semibold">{fmt(emp.base_salary)} ج.م</span>
                    ) : emp.piece_rates?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {emp.piece_rates.map((r: PieceRateRecord) => (
                          <span key={r.id} className="bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded text-xs">
                            {r.category_name}: {fmt(r.piece_rate)}
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-gray-400 text-xs">لا فئات</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {emp.status === 'active' ? 'نشط' : 'غير نشط'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditEmp(emp); setModal('edit'); }} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14}/></button>
                      <button onClick={() => setDelId(emp.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={!!modal} onClose={() => { setModal(null); setEditEmp(null); }}
        title={modal === 'add' ? 'إضافة موظف جديد' : 'تعديل بيانات الموظف'}>
        <EmployeeForm
          initial={editEmp ? { employee_code: editEmp.employee_code, employee_name: editEmp.employee_name,
            department: editEmp.department, job_title: editEmp.job_title, employee_type: editEmp.employee_type,
            base_salary: editEmp.base_salary, status: editEmp.status, notes: editEmp.notes }
            : { ...EMPTY_EMP_FORM }}
          initialRates={editEmp?.piece_rates?.map(r => ({ id: r.id, category_name: r.category_name, piece_rate: r.piece_rate })) ?? []}
          onSave={handleSave} onCancel={() => { setModal(null); setEditEmp(null); }} saving={saving}
        />
      </Modal>
      <DeleteConfirm open={!!delId} onConfirm={handleDel} onCancel={() => setDelId(null)}
        msg="سيتم حذف الموظف وجميع بيانات الإنتاج والسلف والخصومات المرتبطة به." />
    </div>
  );
}

// ==============================================
// PRODUCTION TAB
// ==============================================
function ProductionTab({ employees }: { employees: EmployeeRecord[] }) {
  const toast = useToast();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear]   = useState(CY);
  const [empFilter, setEmpFilter] = useState('');
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal]     = useState<'add' | 'edit' | null>(null);
  const [editRec, setEditRec] = useState<ProductionRecord | null>(null);
  const [saving, setSaving]   = useState(false);
  const [delId, setDelId]     = useState<number | null>(null);

  const [form, setForm] = useState({ employee_id: '', category_name: '', piece_rate: 0, quantity: 0, date: TODAY, notes: '' });
  const selectedEmp = employees.find(e => e.id === +form.employee_id);
  const categories  = selectedEmp?.piece_rates ?? [];

  const load = async () => {
    setLoading(true);
    try { setRecords(await payrollApi.getProduction({ month, year, ...(empFilter ? { employee_id: +empFilter } : {}) })); }
    catch { toast('error', 'خطأ في جلب الإنتاج'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, empFilter]);

  const openAdd = () => {
    setForm({ employee_id: '', category_name: '', piece_rate: 0, quantity: 0, date: TODAY, notes: '' });
    setEditRec(null); setModal('add');
  };
  const openEdit = (r: ProductionRecord) => {
    setForm({ employee_id: String(r.employee_id), category_name: r.category_name,
      piece_rate: r.piece_rate, quantity: r.quantity, date: r.date, notes: r.notes });
    setEditRec(r); setModal('edit');
  };

  const handleSave = async () => {
    if (!form.employee_id || !form.category_name || !form.date) { toast('error', 'اختر الموظف والفئة والتاريخ'); return; }
    setSaving(true);
    try {
      const payload = { employee_id: +form.employee_id, category_name: form.category_name,
        piece_rate: form.piece_rate, quantity: form.quantity, date: form.date, notes: form.notes };
      if (modal === 'add') await payrollApi.addProduction(payload);
      else if (editRec) await payrollApi.updateProduction(editRec.id, payload);
      toast('success', 'تم الحفظ'); setModal(null); load();
    } catch { toast('error', 'خطأ في الحفظ'); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    if (!delId) return;
    try { await payrollApi.removeProduction(delId); toast('success', 'تم الحذف'); load(); }
    catch { toast('error', 'خطأ'); } finally { setDelId(null); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(records.map(r => ({
      'التاريخ': r.date, 'الموظف': r.employee.employee_name, 'الفئة': r.category_name,
      'السعر': r.piece_rate, 'الكمية': r.quantity, 'قيمة الإنتاج': r.production_value, 'ملاحظات': r.notes,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الإنتاج');
    XLSX.writeFile(wb, `إنتاج_${MONTHS[month-1]}_${year}.xlsx`);
  };

  const filtered = records.filter(r => !empFilter || r.employee_id === +empFilter);
  const totalQty = filtered.reduce((s, r) => s + r.quantity, 0);
  const totalVal = filtered.reduce((s, r) => s + r.production_value, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div className="flex gap-2 flex-wrap items-center">
          <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
          <EmpSelect employees={employees} value={empFilter} onChange={setEmpFilter} placeholder="كل الموظفين" includeAll/>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
          <button onClick={openAdd} className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#16304d]"><Plus size={16}/> إضافة إنتاج</button>
        </div>
      </div>

      {/* Totals */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <SumCard label="إجمالي الكميات" value={totalQty} color="blue"/>
          <SumCard label="إجمالي قيمة الإنتاج" value={totalVal} color="purple"/>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr><TH>التاريخ</TH><TH>الموظف</TH><TH>الفئة</TH><TH>السعر</TH><TH>الكمية</TH><TH>قيمة الإنتاج</TH><TH>ملاحظات</TH><TH>إجراءات</TH></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="py-10 text-center text-gray-400">جارٍ التحميل...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={8} className="py-10 text-center text-gray-400">لا يوجد سجلات إنتاج</td></tr>
              : filtered.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 text-gray-600">{r.date}</td>
                  <td className="px-3 py-2.5 font-medium">{r.employee.employee_name}</td>
                  <td className="px-3 py-2.5"><span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-xs">{r.category_name}</span></td>
                  <td className="px-3 py-2.5 text-gray-600">{fmt(r.piece_rate)}</td>
                  <td className="px-3 py-2.5 font-semibold">{fmtN(r.quantity)}</td>
                  <td className="px-3 py-2.5 font-bold text-blue-700">{fmt(r.production_value)}</td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs max-w-xs truncate">{r.notes}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14}/></button>
                      <button onClick={() => setDelId(r.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="bg-[#1e3a5f] text-white text-sm font-bold">
                <tr>
                  <td colSpan={4} className="px-3 py-2.5">الإجمالي</td>
                  <td className="px-3 py-2.5">{fmtN(totalQty)}</td>
                  <td className="px-3 py-2.5">{fmt(totalVal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'إضافة إنتاج' : 'تعديل إنتاج'}>
        <div className="space-y-3 p-1">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">الموظف *</label>
            <select value={form.employee_id} onChange={e => { setForm(p => ({ ...p, employee_id: e.target.value, category_name: '', piece_rate: 0 })); }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              <option value="">اختر الموظف</option>
              {employees.filter(e => e.employee_type === 'piecework').map(e => <option key={e.id} value={e.id}>{e.employee_name}</option>)}
            </select>
          </div>
          {selectedEmp && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">الفئة *</label>
              <select value={form.category_name}
                onChange={e => {
                  const cat = categories.find(c => c.category_name === e.target.value);
                  setForm(p => ({ ...p, category_name: e.target.value, piece_rate: cat?.piece_rate ?? 0 }));
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
                <option value="">اختر الفئة</option>
                {categories.map(c => <option key={c.id} value={c.category_name}>{c.category_name} — {fmt(c.piece_rate)} ج.م</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">السعر (ج.م)</label>
              <input type="number" value={form.piece_rate} readOnly className="w-full border border-gray-100 bg-gray-50 rounded-xl px-3 py-2 text-sm text-gray-500"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">الكمية *</label>
              <input type="number" min="0" value={form.quantity}
                onChange={e => setForm(p => ({ ...p, quantity: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
            </div>
          </div>
          {form.piece_rate > 0 && form.quantity > 0 && (
            <div className="bg-blue-50 rounded-xl px-3 py-2 text-sm text-blue-800 font-semibold">
              قيمة الإنتاج: {fmt(form.quantity * form.piece_rate)} ج.م
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">التاريخ *</label>
            <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ملاحظات</label>
            <input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] disabled:opacity-60 text-sm font-medium">
              {saving ? 'جارٍ الحفظ...' : 'حفظ'}
            </button>
            <button onClick={() => setModal(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 text-sm">إلغاء</button>
          </div>
        </div>
      </Modal>
      <DeleteConfirm open={!!delId} onConfirm={handleDel} onCancel={() => setDelId(null)}/>
    </div>
  );
}

// ==============================================
// GENERIC TRANSACTIONS TAB (Advances / Deductions / Bonuses)
// ==============================================
type TxType = 'advances' | 'deductions' | 'bonuses';

interface TxRecord { id: number; employee_id: number; employee: EmployeeRecord; date: string; amount: number; notes?: string; reason?: string; created_at: string; }

const TX_CONFIG: Record<TxType, { label: string; noteLabel: string; color: string }> = {
  advances:   { label: 'السلفة',  noteLabel: 'ملاحظات', color: 'orange' },
  deductions: { label: 'الخصم',   noteLabel: 'السبب',    color: 'red'    },
  bonuses:    { label: 'المكافأة', noteLabel: 'السبب',    color: 'green'  },
};

function TransactionsTab({ type, employees }: { type: TxType; employees: EmployeeRecord[] }) {
  const toast = useToast();
  const cfg = TX_CONFIG[type];
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear]   = useState(CY);
  const [empFilter, setEmpFilter] = useState('');
  const [records, setRecords] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal]   = useState<'add' | 'edit' | null>(null);
  const [editRec, setEditRec] = useState<TxRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [delId, setDelId]   = useState<number | null>(null);
  const [form, setForm]     = useState({ employee_id: '', date: TODAY, amount: 0, note: '' });

  const apiGet    = type === 'advances' ? payrollApi.getAdvances : type === 'deductions' ? payrollApi.getDeductions : payrollApi.getBonuses;
  const apiAdd    = type === 'advances' ? payrollApi.addAdvance  : type === 'deductions' ? payrollApi.addDeduction  : payrollApi.addBonus;
  const apiUpdate = type === 'advances' ? payrollApi.updateAdvance : type === 'deductions' ? payrollApi.updateDeduction : payrollApi.updateBonus;
  const apiDel    = type === 'advances' ? payrollApi.removeAdvance  : type === 'deductions' ? payrollApi.removeDeduction  : payrollApi.removeBonus;

  const load = async () => {
    setLoading(true);
    try { setRecords((await apiGet({ month, year, ...(empFilter ? { employee_id: +empFilter } : {}) })) as TxRecord[]); }
    catch { toast('error', `خطأ في جلب البيانات`); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, empFilter]);

  const openAdd = () => { setForm({ employee_id: '', date: TODAY, amount: 0, note: '' }); setEditRec(null); setModal('add'); };
  const openEdit = (r: TxRecord) => { setForm({ employee_id: String(r.employee_id), date: r.date, amount: r.amount, note: r.notes ?? r.reason ?? '' }); setEditRec(r); setModal('edit'); };

  const handleSave = async () => {
    if (!form.employee_id || !form.date || form.amount <= 0) { toast('error', 'يرجى تعبئة جميع الحقول بشكل صحيح'); return; }
    setSaving(true);
    try {
      const noteKey = type === 'advances' ? 'notes' : 'reason';
      const payload = { employee_id: +form.employee_id, date: form.date, amount: form.amount, [noteKey]: form.note };
      if (modal === 'add') await (apiAdd as (d: typeof payload) => Promise<TxRecord>)(payload);
      else if (editRec) await (apiUpdate as (id: number, d: Partial<typeof payload>) => Promise<TxRecord>)(editRec.id, payload);
      toast('success', 'تم الحفظ'); setModal(null); load();
    } catch { toast('error', 'خطأ في الحفظ'); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    if (!delId) return;
    try { await (apiDel as (id: number) => Promise<{ message: string }>)(delId); toast('success', 'تم الحذف'); load(); }
    catch { toast('error', 'خطأ'); } finally { setDelId(null); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(records.map(r => ({
      'التاريخ': r.date, 'الموظف': r.employee.employee_name,
      'المبلغ': r.amount, [cfg.noteLabel]: r.notes ?? r.reason ?? '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, cfg.label);
    XLSX.writeFile(wb, `${cfg.label}_${MONTHS[month-1]}_${year}.xlsx`);
  };

  const filtered = records.filter(r => !empFilter || r.employee_id === +empFilter);
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div className="flex gap-2 flex-wrap items-center">
          <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
          <EmpSelect employees={employees} value={empFilter} onChange={setEmpFilter} placeholder="كل الموظفين" includeAll/>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
          <button onClick={openAdd} className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#16304d]"><Plus size={16}/> إضافة {cfg.label}</button>
        </div>
      </div>

      {total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
          <SumCard label={`إجمالي ${type === 'bonuses' ? 'المكافآت' : type === 'advances' ? 'السلف' : 'الخصومات'}`} value={total} color={cfg.color}/>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr><TH>التاريخ</TH><TH>الموظف</TH><TH>المبلغ</TH><TH>{cfg.noteLabel}</TH><TH>إجراءات</TH></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={5} className="py-10 text-center text-gray-400">جارٍ التحميل...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={5} className="py-10 text-center text-gray-400">لا يوجد سجلات</td></tr>
              : filtered.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 text-gray-600">{r.date}</td>
                  <td className="px-3 py-2.5 font-medium">{r.employee.employee_name}</td>
                  <td className="px-3 py-2.5 font-bold text-blue-700">{fmt(r.amount)}</td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{r.notes ?? r.reason ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14}/></button>
                      <button onClick={() => setDelId(r.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="bg-[#1e3a5f] text-white text-sm font-bold">
                <tr>
                  <td colSpan={2} className="px-3 py-2.5">الإجمالي</td>
                  <td className="px-3 py-2.5">{fmt(total)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? `إضافة ${cfg.label}` : `تعديل ${cfg.label}`}>
        <div className="space-y-3 p-1">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">الموظف *</label>
            <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              <option value="">اختر الموظف</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.employee_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">التاريخ *</label>
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">المبلغ *</label>
              <input type="number" min="0" step="0.01" value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">{cfg.noteLabel}</label>
            <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] disabled:opacity-60 text-sm font-medium">
              {saving ? 'جارٍ الحفظ...' : 'حفظ'}
            </button>
            <button onClick={() => setModal(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 text-sm">إلغاء</button>
          </div>
        </div>
      </Modal>
      <DeleteConfirm open={!!delId} onConfirm={handleDel} onCancel={() => setDelId(null)}/>
    </div>
  );
}

// ==============================================
// PAYROLL TAB (كشف المرتبات)
// ==============================================
function printReceipt(row: SalaryRow, month: number, year: number) {
  const emp     = row.employee;
  const isFixed = emp.employee_type === 'fixed';
  const prodRows = row.productions.map(p =>
    `<tr><td>${p.category_name}</td><td>${fmtN(p.quantity)} قطعة × ${fmt(p.piece_rate)} ج.م</td><td>${fmt(p.production_value)} ج.م</td></tr>`
  ).join('');

  const html = `<html dir="rtl"><head><meta charset="utf-8"><title>إيصال راتب</title>
  <style>body{font-family:Arial;padding:25px;font-size:13px}h2{text-align:center;border-bottom:2px solid #000;padding-bottom:8px}
  table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:6px 10px;border:1px solid #ccc;text-align:right}
  .lbl{background:#f5f5f5;font-weight:bold;width:40%}.tot td{font-weight:bold;background:#e8f5e9;font-size:15px}
  .phead th{background:#1e3a5f;color:white}.sig{margin-top:40px;display:flex;justify-content:space-between}
  .sig div{text-align:center;border-top:1px solid #000;padding-top:6px;width:160px}
  .print-date{text-align:left;color:#666;font-size:11px;margin-top:8px}</style></head><body>
  <h2>إيصال راتب — ${MONTHS[month-1]} ${year}</h2>
  <table><tr><td class="lbl">اسم الموظف</td><td>${emp.employee_name}</td><td class="lbl">كود الموظف</td><td>${emp.employee_code}</td></tr>
  <tr><td class="lbl">الإدارة</td><td>${emp.department}</td><td class="lbl">النوع</td><td>${isFixed ? 'راتب ثابت' : 'موظف بالقطعة'}</td></tr>
  <tr><td class="lbl">الشهر</td><td>${MONTHS[month-1]}</td><td class="lbl">السنة</td><td>${year}</td></tr></table>
  <table style="margin-top:14px">
  ${isFixed ? `<tr><td class="lbl">الراتب الأساسي</td><td>${fmt(emp.base_salary)} ج.م</td></tr>` : `
  <tr><th class="phead" colspan="3">تفصيل الإنتاج</th></tr>
  <tr class="phead"><th>الفئة</th><th>الكمية × السعر</th><th>القيمة</th></tr>
  ${prodRows}
  <tr><td class="lbl" colspan="2">إجمالي الإنتاج</td><td>${fmt(row.production_value)} ج.م</td></tr>`}
  <tr><td class="lbl">المكافآت</td><td style="color:green">+ ${fmt(row.total_bonuses)} ج.م</td></tr>
  <tr><td class="lbl">السلف</td><td style="color:red">− ${fmt(row.total_advances)} ج.م</td></tr>
  <tr><td class="lbl">الخصومات</td><td style="color:red">− ${fmt(row.total_deductions)} ج.م</td></tr>
  <tr class="tot"><td colspan="${isFixed ? 1 : 2}">صافي الراتب</td><td>${fmt(row.net_salary)} ج.م</td></tr>
  </table>
  <div class="sig"><div>توقيع الموظف</div><div>توقيع المدير</div><div>الختم</div></div>
  <p class="print-date">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</p>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

function PayrollTab({ employees }: { employees: EmployeeRecord[] }) {
  const toast = useToast();
  const [month, setMonth]   = useState(new Date().getMonth() + 1);
  const [year, setYear]     = useState(CY);
  const [rows, setRows]     = useState<SalaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try { setRows(await payrollApi.getSalary(month, year)); }
    catch { toast('error', 'خطأ في حساب المرتبات'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year]);

  const filtered = rows.filter(r =>
    !search || r.employee.employee_name.includes(search) || r.employee.employee_code.includes(search));

  const totalFixed    = filtered.filter(r => r.employee.employee_type === 'fixed').reduce((s, r) => s + r.net_salary, 0);
  const totalPiece    = filtered.filter(r => r.employee.employee_type === 'piecework').reduce((s, r) => s + r.net_salary, 0);
  const totalAdvances = filtered.reduce((s, r) => s + r.total_advances, 0);
  const totalDed      = filtered.reduce((s, r) => s + r.total_deductions, 0);
  const totalBon      = filtered.reduce((s, r) => s + r.total_bonuses, 0);
  const totalCost     = filtered.reduce((s, r) => s + r.net_salary, 0);

  const printAllReceipts = () => filtered.forEach(r => setTimeout(() => printReceipt(r, month, year), 300));

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({
      'الكود': r.employee.employee_code, 'الاسم': r.employee.employee_name,
      'النوع': r.employee.employee_type === 'fixed' ? 'راتب ثابت' : 'بالقطعة',
      'الراتب/قيمة الإنتاج': r.employee.employee_type === 'fixed' ? r.employee.base_salary : r.production_value,
      'المكافآت': r.total_bonuses, 'السلف': r.total_advances, 'الخصومات': r.total_deductions,
      'صافي الراتب': r.net_salary,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف المرتبات');
    XLSX.writeFile(wb, `مرتبات_${MONTHS[month-1]}_${year}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div className="flex gap-2 flex-wrap items-center">
          <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
              className="pr-9 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-40"/>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
          <button onClick={printAllReceipts} className="flex items-center gap-1.5 bg-gray-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-gray-700"><Printer size={14}/> طباعة الكل</button>
        </div>
      </div>

      {/* Summary cards */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SumCard label="رواتب ثابتة"  value={totalFixed}    color="blue"/>
          <SumCard label="رواتب قطعة"   value={totalPiece}    color="purple"/>
          <SumCard label="إجمالي المكافآت" value={totalBon}   color="green"/>
          <SumCard label="إجمالي السلف"  value={totalAdvances} color="orange"/>
          <SumCard label="إجمالي الخصومات" value={totalDed}   color="red"/>
          <SumCard label="إجمالي التكلفة" value={totalCost}   color="teal"/>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr>
                <TH>الكود</TH><TH>الاسم</TH><TH>النوع</TH>
                <TH>الراتب / قيمة الإنتاج</TH><TH>مكافآت</TH><TH>سلف</TH><TH>خصومات</TH>
                <TH>صافي الراتب</TH><TH center>إيصال</TH>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="py-12 text-center text-gray-400">جارٍ التحميل...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} className="py-10 text-center text-gray-400">لا يوجد بيانات</td></tr>
              : filtered.map((r, i) => {
                const isFixed = r.employee.employee_type === 'fixed';
                return (
                  <tr key={r.employee.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.employee.employee_code}</td>
                    <td className="px-3 py-2.5 font-medium">{r.employee.employee_name}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${isFixed ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {isFixed ? 'ثابت' : 'قطعة'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold">{fmt(isFixed ? r.employee.base_salary : r.production_value)}</td>
                    <td className="px-3 py-2.5 text-green-700 font-semibold">{fmt(r.total_bonuses)}</td>
                    <td className="px-3 py-2.5 text-orange-600">{fmt(r.total_advances)}</td>
                    <td className="px-3 py-2.5 text-red-600">{fmt(r.total_deductions)}</td>
                    <td className="px-3 py-2.5 font-bold text-blue-800 text-base">{fmt(r.net_salary)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => printReceipt(r, month, year)}
                        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg" title="طباعة إيصال">
                        <Printer size={15}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="bg-[#1e3a5f] text-white font-bold text-sm">
                <tr>
                  <td colSpan={3} className="px-3 py-2.5">الإجمالي</td>
                  <td className="px-3 py-2.5">{fmt(totalFixed + totalPiece)}</td>
                  <td className="px-3 py-2.5">{fmt(totalBon)}</td>
                  <td className="px-3 py-2.5">{fmt(totalAdvances)}</td>
                  <td className="px-3 py-2.5">{fmt(totalDed)}</td>
                  <td className="px-3 py-2.5">{fmt(totalCost)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// REPORTS TAB
// ==============================================
function ReportsTab() {
  const toast = useToast();
  const [month, setMonth]   = useState(new Date().getMonth() + 1);
  const [year, setYear]     = useState(CY);
  const [data, setData]     = useState<PayrollReportData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await payrollApi.getReport(month, year)); }
    catch { toast('error', 'خطأ في التقرير'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year]);

  const exportExcel = () => {
    if (!data) return;
    const ws = XLSX.utils.json_to_sheet([
      { 'البند': 'إجمالي الموظفين', 'القيمة': data.total_employees },
      { 'البند': 'موظفو الراتب الثابت', 'القيمة': data.total_fixed_employees },
      { 'البند': 'موظفو القطعة', 'القيمة': data.total_piecework_employees },
      { 'البند': 'إجمالي الرواتب الثابتة', 'القيمة': data.total_fixed_salaries },
      { 'البند': 'إجمالي رواتب القطعة', 'القيمة': data.total_piecework_salaries },
      { 'البند': 'إجمالي السلف', 'القيمة': data.total_advances },
      { 'البند': 'إجمالي الخصومات', 'القيمة': data.total_deductions },
      { 'البند': 'إجمالي المكافآت', 'القيمة': data.total_bonuses },
      { 'البند': 'إجمالي تكلفة الرواتب', 'القيمة': data.total_payroll_cost },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير المرتبات');
    if (data.rows.length) {
      const ws2 = XLSX.utils.json_to_sheet(data.rows.map(r => ({
        'الموظف': r.employee.employee_name, 'النوع': r.employee.employee_type === 'fixed' ? 'ثابت' : 'قطعة',
        'الراتب/الإنتاج': r.employee.employee_type === 'fixed' ? r.employee.base_salary : r.production_value,
        'مكافآت': r.total_bonuses, 'سلف': r.total_advances, 'خصومات': r.total_deductions,
        'الصافي': r.net_salary,
      })));
      XLSX.utils.book_append_sheet(wb, ws2, 'التفاصيل');
    }
    XLSX.writeFile(wb, `تقرير_مرتبات_${MONTHS[month-1]}_${year}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
        <div className="flex gap-2">
          {data && <>
            <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 bg-gray-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-gray-700"><Printer size={14}/> طباعة</button>
          </>}
        </div>
      </div>

      {loading && <div className="py-12 text-center text-gray-400">جارٍ التحميل...</div>}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm text-center">
              <p className="text-xs text-gray-500">إجمالي الموظفين</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">{data.total_employees}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm text-center">
              <p className="text-xs text-blue-500">راتب ثابت</p>
              <p className="text-3xl font-bold text-blue-700 mt-1">{data.total_fixed_employees}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm text-center">
              <p className="text-xs text-purple-500">موظفو القطعة</p>
              <p className="text-3xl font-bold text-purple-700 mt-1">{data.total_piecework_employees}</p>
            </div>
            <div className="bg-gradient-to-br from-[#1e3a5f] to-[#2d5a8f] text-white rounded-2xl p-4 shadow text-center">
              <p className="text-xs text-white/70">إجمالي تكلفة الرواتب</p>
              <p className="text-2xl font-bold mt-1">{fmt(data.total_payroll_cost)}</p>
              <p className="text-xs text-white/50">ج.م</p>
            </div>
          </div>

          {/* Financial summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <SumCard label="رواتب ثابتة"   value={data.total_fixed_salaries}    color="blue"/>
            <SumCard label="رواتب قطعة"    value={data.total_piecework_salaries} color="purple"/>
            <SumCard label="إجمالي المكافآت" value={data.total_bonuses}          color="green"/>
            <SumCard label="إجمالي السلف"   value={data.total_advances}          color="orange"/>
            <SumCard label="إجمالي الخصومات" value={data.total_deductions}       color="red"/>
          </div>

          {/* Detail table */}
          {data.rows.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">تفاصيل — {MONTHS[month-1]} {year}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">الموظف</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">النوع</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">الراتب/الإنتاج</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">مكافآت</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">سلف</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">خصومات</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">صافي الراتب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => {
                      const isFixed = r.employee.employee_type === 'fixed';
                      return (
                        <tr key={r.employee.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2.5 font-medium">{r.employee.employee_name}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${isFixed ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                              {isFixed ? 'ثابت' : 'قطعة'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">{fmt(isFixed ? r.employee.base_salary : r.production_value)}</td>
                          <td className="px-4 py-2.5 text-green-700">{fmt(r.total_bonuses)}</td>
                          <td className="px-4 py-2.5 text-orange-600">{fmt(r.total_advances)}</td>
                          <td className="px-4 py-2.5 text-red-600">{fmt(r.total_deductions)}</td>
                          <td className="px-4 py-2.5 font-bold text-blue-800">{fmt(r.net_salary)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-[#1e3a5f] text-white font-bold text-sm">
                    <tr>
                      <td colSpan={2} className="px-4 py-2.5">الإجمالي</td>
                      <td className="px-4 py-2.5">{fmt(data.total_fixed_salaries + data.total_piecework_salaries)}</td>
                      <td className="px-4 py-2.5">{fmt(data.total_bonuses)}</td>
                      <td className="px-4 py-2.5">{fmt(data.total_advances)}</td>
                      <td className="px-4 py-2.5">{fmt(data.total_deductions)}</td>
                      <td className="px-4 py-2.5">{fmt(data.total_payroll_cost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==============================================
// MAIN PAGE
// ==============================================
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'employees',  label: 'الموظفون',        icon: <Users    size={15}/> },
  { id: 'production', label: 'إنتاج الموظفين',  icon: <Factory  size={15}/> },
  { id: 'advances',   label: 'السلف',            icon: <FileText size={15}/> },
  { id: 'deductions', label: 'الخصومات',         icon: <TrendingDown size={15}/> },
  { id: 'bonuses',    label: 'المكافآت',          icon: <Award    size={15}/> },
  { id: 'payroll',    label: 'كشف المرتبات',     icon: <FileText size={15}/> },
  { id: 'reports',    label: 'التقارير',          icon: <BarChart2 size={15}/> },
];

export default function Payroll() {
  const toast = useToast();
  const [tab, setTab]           = useState<Tab>('employees');
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [empLoading, setEmpLoading] = useState(false);

  const loadEmployees = async () => {
    setEmpLoading(true);
    try { setEmployees(await payrollApi.getEmployees()); }
    catch { toast('error', 'خطأ في جلب الموظفين'); }
    finally { setEmpLoading(false); }
  };

  useEffect(() => { loadEmployees(); }, []);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">نظام المرتبات</h1>
        <p className="text-sm text-gray-500 mt-0.5">إدارة الموظفين والإنتاج والسلف والخصومات والمرتبات</p>
      </div>

      {/* Tab bar */}
      <div className="overflow-x-auto">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-max min-w-full sm:min-w-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                tab === t.id ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'employees'  && <EmployeesTab   employees={employees} loading={empLoading} reload={loadEmployees}/>}
      {tab === 'production' && <ProductionTab  employees={employees}/>}
      {tab === 'advances'   && <TransactionsTab type="advances"   employees={employees}/>}
      {tab === 'deductions' && <TransactionsTab type="deductions" employees={employees}/>}
      {tab === 'bonuses'    && <TransactionsTab type="bonuses"    employees={employees}/>}
      {tab === 'payroll'    && <PayrollTab      employees={employees}/>}
      {tab === 'reports'    && <ReportsTab/>}
    </div>
  );
}

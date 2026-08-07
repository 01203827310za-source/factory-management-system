// ============================================
// Attendance & Payroll Page — الحضور والانصراف والمرتبات
// 4 tabs: Employees | Attendance | Advances & Deductions | Payroll
// ============================================

import { useState, useEffect, useMemo } from 'react';
import {
  Users, ClipboardCheck, DollarSign, Wallet,
  Plus, Edit2, Trash2, Printer, Download, Search,
  ChevronLeft, ChevronRight, FileDown,
} from 'lucide-react';
import {
  payrollApi,
  type EmployeeRecord,
  type AttendanceRecord,
  type AttendanceStatus,
  type SalaryAdjustmentRecord,
  type AdjustmentType,
  type PayrollRow,
} from '../services/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import * as XLSX from 'xlsx';

// ─── constants ───────────────────────────────
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const CY = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CY - 2 + i);
const TODAY = new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 8;

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; color: string }> = {
  present:       { label: 'حاضر',     color: 'bg-green-100 text-green-700' },
  absent:        { label: 'غائب',     color: 'bg-red-100 text-red-700' },
  half_day:      { label: 'نصف يوم',  color: 'bg-amber-100 text-amber-700' },
  vacation:      { label: 'إجازة',    color: 'bg-blue-100 text-blue-700' },
  business_trip: { label: 'مأمورية',  color: 'bg-purple-100 text-purple-700' },
};

const ADJ_CONFIG: Record<AdjustmentType, { label: string; color: string }> = {
  advance:    { label: 'سلفة',    color: 'orange' },
  deduction:  { label: 'خصم',     color: 'red' },
  bonus:      { label: 'مكافأة',  color: 'green' },
};

// ─── helpers ─────────────────────────────────
const fmt  = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

type Tab = 'employees' | 'attendance' | 'adjustments' | 'payroll';

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
        <option key={e.id} value={e.id}>{e.name}</option>
      ))}
    </select>
  );
}

// ─── table header ─────────────────────────────
function TH({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <th className={`px-3 py-3 text-${center ? 'center' : 'right'} font-medium whitespace-nowrap`}>{children}</th>;
}

// ─── summary card ─────────────────────────────
function SumCard({ label, value, color, suffix = 'ج.م' }: { label: string; value: number; color: string; suffix?: string }) {
  const colors: Record<string, string> = {
    blue:   'from-blue-600 to-blue-800',
    green:  'from-emerald-600 to-emerald-800',
    red:    'from-red-600 to-red-800',
    orange: 'from-orange-500 to-orange-700',
    purple: 'from-purple-600 to-purple-800',
    teal:   'from-teal-600 to-teal-800',
    amber:  'from-amber-500 to-amber-700',
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color] ?? colors.blue} text-white rounded-2xl p-4 shadow`}>
      <p className="text-xs text-white/70 mb-1">{label}</p>
      <p className="text-xl font-bold">{suffix === 'ج.م' ? fmt(value) : fmtN(value)}</p>
      <p className="text-xs text-white/50">{suffix}</p>
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

// ─── shared pagination bar ─────────────────────
function PaginationBar({ page, totalPages, setPage }: { page: number; totalPages: number; setPage: (p: number | ((prev: number) => number)) => void }) {
  if (totalPages <= 1) return null;
  return (
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
  );
}

// ─── empty state ────────────────────────────────
function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <tr><td colSpan={colSpan} className="py-12 text-center text-gray-400">{text}</td></tr>;
}

// ==============================================
// EMPLOYEES TAB
// ==============================================
type EmployeeFormState = {
  name: string; phone: string; job_title: string;
  monthly_salary: number; daily_hours: number; status: 'active' | 'inactive';
};

const EMPTY_EMP_FORM: EmployeeFormState = {
  name: '', phone: '', job_title: '', monthly_salary: 0, daily_hours: 8, status: 'active',
};

function EmployeeForm({ initial, onSave, onCancel, saving }: {
  initial: EmployeeFormState; onSave: (f: EmployeeFormState) => void; onCancel: () => void; saving: boolean;
}) {
  const [f, setF] = useState(initial);
  const upd = <K extends keyof EmployeeFormState>(k: K, v: EmployeeFormState[K]) => setF(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">الاسم الكامل *</label>
          <input type="text" value={f.name} onChange={e => upd('name', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">رقم الهاتف</label>
          <input type="text" value={f.phone} onChange={e => upd('phone', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">المسمى الوظيفي</label>
          <input type="text" value={f.job_title} onChange={e => upd('job_title', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">الراتب الشهري</label>
          <input type="number" min="0" value={f.monthly_salary}
            onChange={e => upd('monthly_salary', parseFloat(e.target.value) || 0)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ساعات العمل اليومية</label>
          <input type="number" min="1" step="0.5" value={f.daily_hours}
            onChange={e => upd('daily_hours', parseFloat(e.target.value) || 8)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">الحالة</label>
          <select value={f.status} onChange={e => upd('status', e.target.value === 'inactive' ? 'inactive' : 'active')}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={() => onSave(f)} disabled={saving}
          className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60 text-sm font-medium">
          {saving ? 'جارٍ الحفظ...' : 'حفظ'}
        </button>
        <button onClick={onCancel} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 text-sm">إلغاء</button>
      </div>
    </div>
  );
}

function EmployeesTab({ employees, loading, reload }: {
  employees: EmployeeRecord[]; loading: boolean; reload: () => void;
}) {
  const toast = useToast();
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [modal, setModal]     = useState<'add' | 'edit' | null>(null);
  const [editEmp, setEditEmp] = useState<EmployeeRecord | null>(null);
  const [saving, setSaving]   = useState(false);
  const [delId, setDelId]     = useState<number | null>(null);

  const filtered = employees.filter(e =>
    !search || e.name.includes(search) || e.phone.includes(search) || e.job_title.includes(search));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search]);

  const handleSave = async (f: EmployeeFormState) => {
    if (!f.name.trim()) { toast('error', 'اسم الموظف مطلوب'); return; }
    if (f.daily_hours <= 0) { toast('error', 'ساعات العمل اليومية يجب أن تكون أكبر من صفر'); return; }
    setSaving(true);
    try {
      if (modal === 'add') {
        await payrollApi.addEmployee(f);
        toast('success', 'تم إضافة الموظف');
      } else if (editEmp) {
        await payrollApi.updateEmployee(editEmp.id, f);
        toast('success', 'تم تعديل الموظف');
      }
      setModal(null); setEditEmp(null); reload();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    if (!delId) return;
    try { await payrollApi.removeEmployee(delId); toast('success', 'تم الحذف'); reload(); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في الحذف'); }
    finally { setDelId(null); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(e => ({
      'الاسم': e.name, 'الهاتف': e.phone, 'الوظيفة': e.job_title,
      'الراتب الشهري': e.monthly_salary, 'ساعات العمل اليومية': e.daily_hours,
      'الحالة': e.status === 'active' ? 'نشط' : 'غير نشط',
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
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم أو الهاتف أو الوظيفة..."
            className="pr-9 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-64"/>
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
              <tr><TH>الاسم</TH><TH>الهاتف</TH><TH>الوظيفة</TH><TH>الراتب الشهري</TH><TH>ساعات العمل</TH><TH>الحالة</TH><TH>إجراءات</TH></tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={7} text="جارٍ التحميل..."/>
              : paged.length === 0 ? <EmptyRow colSpan={7} text="لا يوجد موظفون"/>
              : paged.map((emp, i) => (
                <tr key={emp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 font-medium">{emp.name}</td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{emp.phone || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600">{emp.job_title || '—'}</td>
                  <td className="px-3 py-2.5 font-semibold">{fmt(emp.monthly_salary)} ج.م</td>
                  <td className="px-3 py-2.5">{fmtN(emp.daily_hours)} ساعة</td>
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
        <PaginationBar page={page} totalPages={totalPages} setPage={setPage}/>
      </div>

      <Modal isOpen={!!modal} onClose={() => { setModal(null); setEditEmp(null); }}
        title={modal === 'add' ? 'إضافة موظف جديد' : 'تعديل بيانات الموظف'}>
        <EmployeeForm
          initial={editEmp ? { name: editEmp.name, phone: editEmp.phone, job_title: editEmp.job_title,
            monthly_salary: editEmp.monthly_salary, daily_hours: editEmp.daily_hours, status: editEmp.status }
            : { ...EMPTY_EMP_FORM }}
          onSave={handleSave} onCancel={() => { setModal(null); setEditEmp(null); }} saving={saving}
        />
      </Modal>
      <DeleteConfirm open={!!delId} onConfirm={handleDel} onCancel={() => setDelId(null)}
        msg="سيتم حذف الموظف وجميع سجلات الحضور والسلف والخصومات والمرتبات المرتبطة به." />
    </div>
  );
}

// ==============================================
// ATTENDANCE TAB
// ==============================================
type AttendanceFormState = {
  employee_id: string; date: string; check_in: string; check_out: string;
  status: AttendanceStatus; notes: string;
};

const EMPTY_ATT_FORM: AttendanceFormState = {
  employee_id: '', date: TODAY, check_in: '', check_out: '', status: 'present', notes: '',
};

function previewHours(f: AttendanceFormState, dailyHours: number) {
  if (f.status === 'absent' || !f.check_in || !f.check_out) return null;
  const [inH, inM]   = f.check_in.split(':').map(Number);
  const [outH, outM] = f.check_out.split(':').map(Number);
  if ([inH, inM, outH, outM].some(n => Number.isNaN(n))) return null;
  let minutes = (outH * 60 + outM) - (inH * 60 + inM);
  if (minutes < 0) minutes += 24 * 60;
  const worked = Math.round((minutes / 60) * 100) / 100;
  const overtime = Math.round(Math.max(0, worked - dailyHours) * 100) / 100;
  return { worked, overtime };
}

function AttendanceTab({ employees }: { employees: EmployeeRecord[] }) {
  const toast = useToast();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear]   = useState(CY);
  const [empFilter, setEmpFilter] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal]     = useState<'add' | 'edit' | null>(null);
  const [editRec, setEditRec] = useState<AttendanceRecord | null>(null);
  const [saving, setSaving]   = useState(false);
  const [delId, setDelId]     = useState<number | null>(null);
  const [form, setForm]       = useState<AttendanceFormState>(EMPTY_ATT_FORM);

  const load = async () => {
    setLoading(true);
    try { setRecords(await payrollApi.getAttendance({ month, year, ...(empFilter ? { employee_id: +empFilter } : {}) })); }
    catch { toast('error', 'خطأ في جلب سجلات الحضور'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, empFilter]);

  const openAdd  = () => { setForm(EMPTY_ATT_FORM); setEditRec(null); setModal('add'); };
  const openEdit = (r: AttendanceRecord) => {
    setForm({ employee_id: String(r.employee_id), date: r.date, check_in: r.check_in, check_out: r.check_out, status: r.status, notes: r.notes });
    setEditRec(r); setModal('edit');
  };

  const selectedEmp = employees.find(e => e.id === +form.employee_id);
  const preview = selectedEmp ? previewHours(form, selectedEmp.daily_hours) : null;

  const handleSave = async () => {
    if (!form.employee_id || !form.date) { toast('error', 'اختر الموظف والتاريخ'); return; }
    if (form.status !== 'absent' && (!form.check_in || !form.check_out)) {
      toast('error', 'يرجى إدخال وقت الحضور والانصراف'); return;
    }
    setSaving(true);
    try {
      const payload = {
        employee_id: +form.employee_id, date: form.date, status: form.status,
        check_in: form.status === 'absent' ? '' : form.check_in,
        check_out: form.status === 'absent' ? '' : form.check_out,
        notes: form.notes,
      };
      if (modal === 'add') await payrollApi.addAttendance(payload);
      else if (editRec) await payrollApi.updateAttendance(editRec.id, payload);
      toast('success', 'تم الحفظ'); setModal(null); load();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في الحفظ'); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    if (!delId) return;
    try { await payrollApi.removeAttendance(delId); toast('success', 'تم الحذف'); load(); }
    catch { toast('error', 'خطأ'); } finally { setDelId(null); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(records.map(r => ({
      'التاريخ': r.date, 'الموظف': r.employee.name, 'الحضور': r.check_in || '—', 'الانصراف': r.check_out || '—',
      'ساعات العمل': r.worked_hours, 'الساعات الإضافية': r.overtime_hours,
      'الحالة': STATUS_CONFIG[r.status].label, 'ملاحظات': r.notes,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الحضور والانصراف');
    XLSX.writeFile(wb, `الحضور_${MONTHS[month-1]}_${year}.xlsx`);
  };

  const totalWorked   = records.reduce((s, r) => s + r.worked_hours, 0);
  const totalOvertime = records.reduce((s, r) => s + r.overtime_hours, 0);
  const totalAbsent   = records.filter(r => r.status === 'absent').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div className="flex gap-2 flex-wrap items-center">
          <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
          <EmpSelect employees={employees} value={empFilter} onChange={setEmpFilter} placeholder="كل الموظفين" includeAll/>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
          <button onClick={openAdd} className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#16304d]"><Plus size={16}/> تسجيل حضور</button>
        </div>
      </div>

      {records.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SumCard label="إجمالي ساعات العمل" value={totalWorked} color="blue" suffix="ساعة"/>
          <SumCard label="إجمالي الساعات الإضافية" value={totalOvertime} color="amber" suffix="ساعة"/>
          <SumCard label="أيام الغياب" value={totalAbsent} color="red" suffix="يوم"/>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr><TH>التاريخ</TH><TH>الموظف</TH><TH>الحضور</TH><TH>الانصراف</TH><TH>ساعات العمل</TH><TH>الإضافي</TH><TH>الحالة</TH><TH>ملاحظات</TH><TH>إجراءات</TH></tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={9} text="جارٍ التحميل..."/>
              : records.length === 0 ? <EmptyRow colSpan={9} text="لا يوجد سجلات حضور"/>
              : records.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 text-gray-600">{r.date}</td>
                  <td className="px-3 py-2.5 font-medium">{r.employee.name}</td>
                  <td className="px-3 py-2.5">{r.check_in || '—'}</td>
                  <td className="px-3 py-2.5">{r.check_out || '—'}</td>
                  <td className="px-3 py-2.5 font-semibold">{r.worked_hours ? fmtN(r.worked_hours) : '—'}</td>
                  <td className="px-3 py-2.5 text-amber-700 font-semibold">{r.overtime_hours ? fmtN(r.overtime_hours) : '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[r.status].color}`}>{STATUS_CONFIG[r.status].label}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs max-w-xs truncate">{r.notes || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14}/></button>
                      <button onClick={() => setDelId(r.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'تسجيل حضور' : 'تعديل سجل الحضور'}>
        <div className="space-y-3 p-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">الموظف *</label>
              <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
                <option value="">اختر الموظف</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">التاريخ *</label>
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">حالة الحضور *</label>
            <select value={form.status}
              onChange={e => {
                const status = e.target.value as AttendanceStatus;
                setForm(p => ({ ...p, status, ...(status === 'absent' ? { check_in: '', check_out: '' } : {}) }));
              }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
            </select>
          </div>

          {form.status !== 'absent' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">وقت الحضور *</label>
                <input type="time" value={form.check_in} onChange={e => setForm(p => ({ ...p, check_in: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">وقت الانصراف *</label>
                <input type="time" value={form.check_out} onChange={e => setForm(p => ({ ...p, check_out: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"/>
              </div>
            </div>
          )}

          {preview && (
            <div className="bg-blue-50 rounded-xl px-3 py-2 text-sm text-blue-800 font-semibold flex justify-between">
              <span>ساعات العمل: {fmtN(preview.worked)}</span>
              {preview.overtime > 0 && <span className="text-amber-700">الإضافي: {fmtN(preview.overtime)}</span>}
            </div>
          )}

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
// ADJUSTMENTS TAB (Advances / Deductions / Bonuses)
// ==============================================
function AdjustmentsTab({ employees }: { employees: EmployeeRecord[] }) {
  const toast = useToast();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear]   = useState(CY);
  const [empFilter, setEmpFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<AdjustmentType | ''>('');
  const [records, setRecords] = useState<SalaryAdjustmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal]     = useState<'add' | 'edit' | null>(null);
  const [editRec, setEditRec] = useState<SalaryAdjustmentRecord | null>(null);
  const [saving, setSaving]   = useState(false);
  const [delId, setDelId]     = useState<number | null>(null);
  const [form, setForm]       = useState({ employee_id: '', date: TODAY, type: 'advance' as AdjustmentType, amount: 0, reason: '' });

  const load = async () => {
    setLoading(true);
    try {
      setRecords(await payrollApi.getAdjustments({
        month, year, ...(empFilter ? { employee_id: +empFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}),
      }));
    } catch { toast('error', 'خطأ في جلب البيانات'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year, empFilter, typeFilter]);

  const openAdd  = () => { setForm({ employee_id: '', date: TODAY, type: 'advance', amount: 0, reason: '' }); setEditRec(null); setModal('add'); };
  const openEdit = (r: SalaryAdjustmentRecord) => { setForm({ employee_id: String(r.employee_id), date: r.date, type: r.type, amount: r.amount, reason: r.reason }); setEditRec(r); setModal('edit'); };

  const handleSave = async () => {
    if (!form.employee_id || !form.date) { toast('error', 'اختر الموظف والتاريخ'); return; }
    if (form.amount <= 0) { toast('error', 'المبلغ يجب أن يكون أكبر من صفر'); return; }
    setSaving(true);
    try {
      const payload = { employee_id: +form.employee_id, date: form.date, type: form.type, amount: form.amount, reason: form.reason };
      if (modal === 'add') await payrollApi.addAdjustment(payload);
      else if (editRec) await payrollApi.updateAdjustment(editRec.id, payload);
      toast('success', 'تم الحفظ'); setModal(null); load();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في الحفظ'); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    if (!delId) return;
    try { await payrollApi.removeAdjustment(delId); toast('success', 'تم الحذف'); load(); }
    catch { toast('error', 'خطأ'); } finally { setDelId(null); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(records.map(r => ({
      'التاريخ': r.date, 'الموظف': r.employee.name, 'النوع': ADJ_CONFIG[r.type].label,
      'المبلغ': r.amount, 'السبب': r.reason || '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'السلف والخصومات');
    XLSX.writeFile(wb, `السلف_والخصومات_${MONTHS[month-1]}_${year}.xlsx`);
  };

  const totalAdvances   = records.filter(r => r.type === 'advance').reduce((s, r) => s + r.amount, 0);
  const totalDeductions = records.filter(r => r.type === 'deduction').reduce((s, r) => s + r.amount, 0);
  const totalBonuses    = records.filter(r => r.type === 'bonus').reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div className="flex gap-2 flex-wrap items-center">
          <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
          <EmpSelect employees={employees} value={empFilter} onChange={setEmpFilter} placeholder="كل الموظفين" includeAll/>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as AdjustmentType | '')}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
            <option value="">كل الأنواع</option>
            {(Object.keys(ADJ_CONFIG) as AdjustmentType[]).map(t => <option key={t} value={t}>{ADJ_CONFIG[t].label}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
          <button onClick={openAdd} className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#16304d]"><Plus size={16}/> إضافة حركة</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SumCard label="إجمالي السلف" value={totalAdvances} color="orange"/>
        <SumCard label="إجمالي الخصومات" value={totalDeductions} color="red"/>
        <SumCard label="إجمالي المكافآت" value={totalBonuses} color="green"/>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr><TH>التاريخ</TH><TH>الموظف</TH><TH>النوع</TH><TH>المبلغ</TH><TH>السبب</TH><TH>إجراءات</TH></tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={6} text="جارٍ التحميل..."/>
              : records.length === 0 ? <EmptyRow colSpan={6} text="لا يوجد سجلات"/>
              : records.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 text-gray-600">{r.date}</td>
                  <td className="px-3 py-2.5 font-medium">{r.employee.name}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium bg-${ADJ_CONFIG[r.type].color}-100 text-${ADJ_CONFIG[r.type].color}-700`}>
                      {ADJ_CONFIG[r.type].label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-bold text-blue-700">{fmt(r.amount)}</td>
                  <td className="px-3 py-2.5 text-gray-500 text-xs">{r.reason || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={14}/></button>
                      <button onClick={() => setDelId(r.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'إضافة حركة' : 'تعديل حركة'}>
        <div className="space-y-3 p-1">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">الموظف *</label>
            <select value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              <option value="">اختر الموظف</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">النوع *</label>
            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as AdjustmentType }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
              {(Object.keys(ADJ_CONFIG) as AdjustmentType[]).map(t => <option key={t} value={t}>{ADJ_CONFIG[t].label}</option>)}
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
            <label className="block text-xs font-medium text-gray-600 mb-1">السبب</label>
            <input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
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
// PAYROLL TAB (كشف المرتبات — توليد تلقائي)
// ==============================================
function printPayrollSheet(rows: PayrollRow[], month: number, year: number) {
  const body = rows.map(r => `
    <tr>
      <td>${r.employee.name}</td>
      <td>${fmtN(r.attendance_days)}</td>
      <td>${fmtN(r.absent_days)}</td>
      <td>${fmtN(r.half_days)}</td>
      <td>${fmtN(r.worked_hours)}</td>
      <td>${fmtN(r.overtime_hours)}</td>
      <td>${fmt(r.overtime_amount)}</td>
      <td>${fmt(r.advances)}</td>
      <td>${fmt(r.deductions)}</td>
      <td>${fmt(r.bonuses)}</td>
      <td>${fmt(r.base_salary)}</td>
      <td style="font-weight:bold">${fmt(r.net_salary)}</td>
    </tr>`).join('');

  const totalNet = rows.reduce((s, r) => s + r.net_salary, 0);

  const html = `<html dir="rtl"><head><meta charset="utf-8"><title>كشف المرتبات</title>
  <style>body{font-family:Arial;padding:20px;font-size:12px}h2{text-align:center;border-bottom:2px solid #000;padding-bottom:8px}
  table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:6px 8px;border:1px solid #ccc;text-align:right}
  th{background:#1e3a5f;color:#fff}.tot td{font-weight:bold;background:#e8f5e9}
  .print-date{text-align:left;color:#666;font-size:11px;margin-top:8px}</style></head><body>
  <h2>كشف المرتبات — ${MONTHS[month-1]} ${year}</h2>
  <table>
    <thead><tr><th>الموظف</th><th>أيام حضور</th><th>أيام غياب</th><th>نصف يوم</th><th>ساعات عمل</th><th>ساعات إضافية</th><th>مبلغ الإضافي</th><th>سلف</th><th>خصومات</th><th>مكافآت</th><th>الراتب الأساسي</th><th>صافي الراتب</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr class="tot"><td colspan="11">الإجمالي</td><td>${fmt(totalNet)} ج.م</td></tr></tfoot>
  </table>
  <p class="print-date">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</p>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

function PayrollTab() {
  const toast = useToast();
  const [month, setMonth]     = useState(new Date().getMonth() + 1);
  const [year, setYear]       = useState(CY);
  const [rows, setRows]       = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated]   = useState(false);

  const load = async () => {
    setLoading(true);
    setGenerated(false);
    try { setRows(await payrollApi.getRecords(month, year)); }
    catch { toast('error', 'خطأ في جلب كشف المرتبات'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month, year]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await payrollApi.generate(month, year);
      setRows(result);
      setGenerated(true);
      toast('success', result.length ? 'تم توليد المرتبات بنجاح' : 'لا يوجد موظفون نشطون لتوليد مرتباتهم');
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في توليد المرتبات'); }
    finally { setGenerating(false); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'الموظف': r.employee.name, 'أيام الحضور': r.attendance_days, 'أيام الغياب': r.absent_days, 'نصف يوم': r.half_days,
      'ساعات العمل': r.worked_hours, 'ساعات إضافية': r.overtime_hours, 'مبلغ الإضافي': r.overtime_amount,
      'سلف': r.advances, 'خصومات': r.deductions, 'مكافآت': r.bonuses,
      'الراتب الأساسي': r.base_salary, 'صافي الراتب': r.net_salary,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف المرتبات');
    XLSX.writeFile(wb, `مرتبات_${MONTHS[month-1]}_${year}.xlsx`);
  };

  const totalBase      = rows.reduce((s, r) => s + r.base_salary, 0);
  const totalOvertime  = rows.reduce((s, r) => s + r.overtime_amount, 0);
  const totalAdvances  = rows.reduce((s, r) => s + r.advances, 0);
  const totalDed       = rows.reduce((s, r) => s + r.deductions, 0);
  const totalBonuses   = rows.reduce((s, r) => s + r.bonuses, 0);
  const totalNet        = rows.reduce((s, r) => s + r.net_salary, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <MonthYearBar month={month} year={year} setMonth={setMonth} setYear={setYear}/>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#16304d] disabled:opacity-60">
            <Wallet size={16}/> {generating ? 'جارٍ التوليد...' : 'توليد المرتبات'}
          </button>
          {rows.length > 0 && <>
            <button onClick={exportExcel} className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-emerald-700"><Download size={14}/> Excel</button>
            <button onClick={() => printPayrollSheet(rows, month, year)} className="flex items-center gap-1.5 bg-gray-600 text-white px-3 py-2 rounded-xl text-sm hover:bg-gray-700"><Printer size={14}/> طباعة</button>
            <button onClick={() => printPayrollSheet(rows, month, year)} className="flex items-center gap-1.5 bg-slate-700 text-white px-3 py-2 rounded-xl text-sm hover:bg-slate-800"><FileDown size={14}/> تصدير PDF</button>
          </>}
        </div>
      </div>

      {!generated && rows.length > 0 && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          هذه آخر مرتبات تم توليدها لهذا الشهر — اضغط "توليد المرتبات" لإعادة الحساب بعد أي تعديل على الحضور أو السلف أو الخصومات.
        </p>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SumCard label="الرواتب الأساسية" value={totalBase} color="blue"/>
          <SumCard label="إجمالي الإضافي" value={totalOvertime} color="amber"/>
          <SumCard label="إجمالي المكافآت" value={totalBonuses} color="green"/>
          <SumCard label="إجمالي السلف" value={totalAdvances} color="orange"/>
          <SumCard label="إجمالي الخصومات" value={totalDed} color="red"/>
          <SumCard label="صافي إجمالي الرواتب" value={totalNet} color="teal"/>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f] text-white text-xs">
              <tr>
                <TH>الموظف</TH><TH center>أيام حضور</TH><TH center>أيام غياب</TH><TH center>نصف يوم</TH>
                <TH center>ساعات عمل</TH><TH center>ساعات إضافية</TH><TH>مبلغ الإضافي</TH>
                <TH>سلف</TH><TH>خصومات</TH><TH>مكافآت</TH><TH>الراتب الأساسي</TH><TH>صافي الراتب</TH>
              </tr>
            </thead>
            <tbody>
              {loading ? <EmptyRow colSpan={12} text="جارٍ التحميل..."/>
              : rows.length === 0 ? <EmptyRow colSpan={12} text={`لا توجد مرتبات مولّدة لشهر ${MONTHS[month-1]} ${year} — اضغط "توليد المرتبات"`}/>
              : rows.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-3 py-2.5 font-medium">{r.employee.name}</td>
                  <td className="px-3 py-2.5 text-center">{fmtN(r.attendance_days)}</td>
                  <td className="px-3 py-2.5 text-center text-red-600">{fmtN(r.absent_days)}</td>
                  <td className="px-3 py-2.5 text-center">{fmtN(r.half_days)}</td>
                  <td className="px-3 py-2.5 text-center">{fmtN(r.worked_hours)}</td>
                  <td className="px-3 py-2.5 text-center text-amber-700">{fmtN(r.overtime_hours)}</td>
                  <td className="px-3 py-2.5">{fmt(r.overtime_amount)}</td>
                  <td className="px-3 py-2.5 text-orange-600">{fmt(r.advances)}</td>
                  <td className="px-3 py-2.5 text-red-600">{fmt(r.deductions)}</td>
                  <td className="px-3 py-2.5 text-green-700">{fmt(r.bonuses)}</td>
                  <td className="px-3 py-2.5 font-semibold">{fmt(r.base_salary)}</td>
                  <td className="px-3 py-2.5 font-bold text-blue-800 text-base">{fmt(r.net_salary)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-[#1e3a5f] text-white font-bold text-sm">
                <tr>
                  <td colSpan={6} className="px-3 py-2.5">الإجمالي</td>
                  <td className="px-3 py-2.5">{fmt(totalOvertime)}</td>
                  <td className="px-3 py-2.5">{fmt(totalAdvances)}</td>
                  <td className="px-3 py-2.5">{fmt(totalDed)}</td>
                  <td className="px-3 py-2.5">{fmt(totalBonuses)}</td>
                  <td className="px-3 py-2.5">{fmt(totalBase)}</td>
                  <td className="px-3 py-2.5">{fmt(totalNet)}</td>
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
// MAIN PAGE
// ==============================================
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'employees',   label: 'الموظفون',           icon: <Users          size={15}/> },
  { id: 'attendance',  label: 'الحضور والانصراف',    icon: <ClipboardCheck size={15}/> },
  { id: 'adjustments', label: 'السلف والخصومات',     icon: <DollarSign     size={15}/> },
  { id: 'payroll',     label: 'كشف المرتبات',        icon: <Wallet         size={15}/> },
];

export default function Payroll() {
  const toast = useToast();
  const [tab, setTab]             = useState<Tab>('employees');
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [empLoading, setEmpLoading] = useState(false);

  const loadEmployees = async () => {
    setEmpLoading(true);
    try { setEmployees(await payrollApi.getEmployees()); }
    catch { toast('error', 'خطأ في جلب الموظفين'); }
    finally { setEmpLoading(false); }
  };

  useEffect(() => { loadEmployees(); }, []);

  const activeEmployeesCount = useMemo(() => employees.filter(e => e.status === 'active').length, [employees]);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">نظام الحضور والانصراف والمرتبات</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          إدارة الموظفين والحضور والسلف والخصومات وتوليد المرتبات تلقائياً — {activeEmployeesCount} موظف نشط
        </p>
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
      {tab === 'employees'   && <EmployeesTab   employees={employees} loading={empLoading} reload={loadEmployees}/>}
      {tab === 'attendance'  && <AttendanceTab  employees={employees}/>}
      {tab === 'adjustments' && <AdjustmentsTab employees={employees}/>}
      {tab === 'payroll'     && <PayrollTab/>}
    </div>
  );
}

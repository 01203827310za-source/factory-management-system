// ============================================
// Payroll Management Page — المرتبات
// Tabs: Employees | Monthly Payroll | Reports
// ============================================

import { useState, useEffect, useRef } from 'react';
import { Users, FileText, BarChart2, Plus, Edit2, Trash2, Printer, Download, Search, ChevronDown } from 'lucide-react';
import { payrollApi, type EmployeeRecord, type PayrollRecordFull, type PayrollReportData } from '../services/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import * as XLSX from 'xlsx';

// ─── Helpers ───────────────────────────────
const fmt = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);

function calcNet(r: Partial<PayrollRecordFull>, emp: EmployeeRecord | null): number {
  if (!emp) return 0;
  if (emp.employee_type === 'fixed') {
    const base = emp.base_salary;
    return base - (r.absence_deduction ?? 0) - (r.advances ?? 0) - (r.additional_deductions ?? 0) + (r.bonus ?? 0);
  } else {
    const pieceIncome = (r.produced_qty ?? 0) * emp.piece_rate;
    return pieceIncome + (r.production_bonus ?? 0) - (r.advances ?? 0) - (r.additional_deductions ?? 0);
  }
}

// ─── Receipt Print Component ───────────────
function printReceipt(rec: PayrollRecordFull) {
  const emp = rec.employee;
  const isFixed = emp.employee_type === 'fixed';
  const html = `
  <html dir="rtl"><head><meta charset="utf-8"/><title>إيصال راتب</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; font-size: 14px; }
    h2 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 7px 10px; border: 1px solid #ccc; }
    .label { background: #f5f5f5; font-weight: bold; width: 40%; }
    .total td { font-weight: bold; background: #e8f4fd; }
    .sig { margin-top: 40px; display: flex; justify-content: space-between; }
    .sig div { text-align: center; border-top: 1px solid #000; padding-top: 6px; width: 200px; }
  </style></head><body>
  <h2>إيصال راتب — ${MONTHS[rec.month - 1]} ${rec.year}</h2>
  <table>
    <tr><td class="label">اسم الموظف</td><td>${emp.employee_name}</td><td class="label">كود الموظف</td><td>${emp.employee_code}</td></tr>
    <tr><td class="label">الإدارة</td><td>${emp.department}</td><td class="label">المسمى الوظيفي</td><td>${emp.job_title || emp.piece_category}</td></tr>
    <tr><td class="label">الشهر</td><td>${MONTHS[rec.month - 1]}</td><td class="label">السنة</td><td>${rec.year}</td></tr>
  </table>
  <table style="margin-top:16px">
    ${isFixed ? `
    <tr><td class="label">الراتب الأساسي</td><td>${fmt(emp.base_salary)} ج.م</td></tr>
    <tr><td class="label">أيام الحضور</td><td>${rec.attendance_days}</td></tr>
    <tr><td class="label">أيام الغياب</td><td>${rec.absence_days}</td></tr>
    <tr><td class="label">خصم الغياب</td><td style="color:red">- ${fmt(rec.absence_deduction)} ج.م</td></tr>
    <tr><td class="label">المكافأة</td><td style="color:green">+ ${fmt(rec.bonus)} ج.م</td></tr>
    <tr><td class="label">سلف</td><td style="color:red">- ${fmt(rec.advances)} ج.م</td></tr>
    <tr><td class="label">خصومات إضافية</td><td style="color:red">- ${fmt(rec.additional_deductions)} ج.م</td></tr>
    ` : `
    <tr><td class="label">الكمية المنتجة</td><td>${rec.produced_qty} قطعة</td></tr>
    <tr><td class="label">سعر القطعة</td><td>${fmt(emp.piece_rate)} ج.م</td></tr>
    <tr><td class="label">دخل القطعة</td><td>${fmt(rec.piece_income)} ج.م</td></tr>
    <tr><td class="label">مكافأة الإنتاج</td><td style="color:green">+ ${fmt(rec.production_bonus)} ج.م</td></tr>
    <tr><td class="label">سلف</td><td style="color:red">- ${fmt(rec.advances)} ج.م</td></tr>
    <tr><td class="label">خصومات</td><td style="color:red">- ${fmt(rec.additional_deductions)} ج.م</td></tr>
    `}
    <tr class="total"><td>صافي الراتب</td><td>${fmt(rec.net_salary)} ج.م</td></tr>
  </table>
  <div class="sig">
    <div>توقيع الموظف</div>
    <div>توقيع المدير</div>
    <div>الختم</div>
  </div>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

// ─────────────────────────────────────────────
// EMPLOYEE FORM
// ─────────────────────────────────────────────
const EMPTY_EMP: Omit<EmployeeRecord, 'id' | 'created_at' | 'updated_at'> = {
  employee_code: '', employee_name: '', department: '', job_title: '',
  employee_type: 'fixed', base_salary: 0, piece_category: '', piece_rate: 0,
  status: 'active', notes: '',
};

function EmployeeForm({ initial, onSave, onCancel, loading }: {
  initial: Omit<EmployeeRecord, 'id' | 'created_at' | 'updated_at'>;
  onSave: (d: typeof initial) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: unknown) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-sm font-medium text-gray-700 mb-1">كود الموظف *</label>
          <input className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.employee_code} onChange={e => set('employee_code', e.target.value)} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">اسم الموظف *</label>
          <input className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.employee_name} onChange={e => set('employee_name', e.target.value)} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">الإدارة</label>
          <input className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.department} onChange={e => set('department', e.target.value)} /></div>
        <div><label className="block text-sm font-medium text-gray-700 mb-1">نوع الموظف</label>
          <select className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.employee_type} onChange={e => set('employee_type', e.target.value)}>
            <option value="fixed">موظف راتب ثابت</option>
            <option value="piecework">موظف بالقطعة</option>
          </select></div>
        {form.employee_type === 'fixed' ? (
          <>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">المسمى الوظيفي</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.job_title} onChange={e => set('job_title', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">الراتب الأساسي</label>
              <input type="number" min="0" className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.base_salary} onChange={e => set('base_salary', parseFloat(e.target.value) || 0)} /></div>
          </>
        ) : (
          <>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">فئة القطعة</label>
              <input className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.piece_category} onChange={e => set('piece_category', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">سعر القطعة</label>
              <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.piece_rate} onChange={e => set('piece_rate', parseFloat(e.target.value) || 0)} /></div>
          </>
        )}
        <div><label className="block text-sm font-medium text-gray-700 mb-1">الحالة</label>
          <select className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
          </select></div>
        <div className="col-span-2"><label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
          <textarea rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]" value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={() => onSave(form)} disabled={loading} className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60">
          {loading ? 'جارٍ الحفظ...' : 'حفظ'}
        </button>
        <button onClick={onCancel} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PAYROLL RECORD EDIT FORM
// ─────────────────────────────────────────────
function PayrollEditForm({ rec, onSave, onCancel, loading }: {
  rec: PayrollRecordFull;
  onSave: (d: Partial<PayrollRecordFull>) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const isFixed = rec.employee.employee_type === 'fixed';
  const [form, setForm] = useState({
    attendance_days: rec.attendance_days,
    absence_days: rec.absence_days,
    absence_deduction: rec.absence_deduction,
    advances: rec.advances,
    additional_deductions: rec.additional_deductions,
    bonus: rec.bonus,
    produced_qty: rec.produced_qty,
    production_bonus: rec.production_bonus,
  });
  const set = (k: keyof typeof form, v: number) => setForm(p => ({ ...p, [k]: v }));

  const pieceIncome = form.produced_qty * rec.employee.piece_rate;
  const net = isFixed
    ? rec.employee.base_salary - form.absence_deduction - form.advances - form.additional_deductions + form.bonus
    : pieceIncome + form.production_bonus - form.advances - form.additional_deductions;

  const numField = (label: string, key: keyof typeof form, step = 1) => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type="number" min="0" step={step}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        value={form[key]} onChange={e => set(key, parseFloat(e.target.value) || 0)} />
    </div>
  );

  return (
    <div className="space-y-4 p-1">
      <div className="bg-blue-50 rounded-xl p-3 text-sm">
        <span className="font-semibold">{rec.employee.employee_name}</span> — {MONTHS[rec.month - 1]} {rec.year}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {isFixed ? (
          <>
            {numField('أيام الحضور', 'attendance_days')}
            {numField('أيام الغياب', 'absence_days')}
            {numField('خصم الغياب', 'absence_deduction', 0.01)}
            {numField('المكافأة', 'bonus', 0.01)}
            {numField('سلف', 'advances', 0.01)}
            {numField('خصومات إضافية', 'additional_deductions', 0.01)}
          </>
        ) : (
          <>
            {numField('الكمية المنتجة', 'produced_qty')}
            {numField('مكافأة الإنتاج', 'production_bonus', 0.01)}
            {numField('سلف', 'advances', 0.01)}
            {numField('خصومات', 'additional_deductions', 0.01)}
          </>
        )}
      </div>
      {!isFixed && (
        <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-600">
          دخل القطعة: {fmt(pieceIncome)} ج.م ({form.produced_qty} × {rec.employee.piece_rate})
        </div>
      )}
      <div className="bg-green-50 rounded-xl p-3 text-base font-bold text-green-800">
        صافي الراتب: {fmt(net)} ج.م
      </div>
      <div className="flex gap-3">
        <button onClick={() => onSave({ ...form, piece_income: pieceIncome, net_salary: net })} disabled={loading}
          className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60">
          {loading ? 'جارٍ الحفظ...' : 'حفظ'}
        </button>
        <button onClick={onCancel} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function Payroll() {
  const toast = useToast();
  const [tab, setTab] = useState<'employees' | 'payroll' | 'reports'>('employees');

  // ── Employees state ──
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [empModal, setEmpModal] = useState<'add' | 'edit' | null>(null);
  const [editEmp, setEditEmp] = useState<EmployeeRecord | null>(null);
  const [empSaving, setEmpSaving] = useState(false);
  const [delEmpId, setDelEmpId] = useState<number | null>(null);

  // ── Payroll state ──
  const [payMonth, setPayMonth] = useState(new Date().getMonth() + 1);
  const [payYear, setPayYear]   = useState(currentYear);
  const [payRecords, setPayRecords] = useState<PayrollRecordFull[]>([]);
  const [payLoading, setPayLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editRec, setEditRec] = useState<PayrollRecordFull | null>(null);
  const [recSaving, setRecSaving] = useState(false);
  const [printRec, setPrintRec] = useState<PayrollRecordFull | null>(null);
  const [paySearch, setPaySearch] = useState('');
  const [payDept, setPayDept] = useState('');

  // ── Reports state ──
  const [repMonth, setRepMonth] = useState(new Date().getMonth() + 1);
  const [repYear, setRepYear]   = useState(currentYear);
  const [report, setReport]     = useState<PayrollReportData | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repEmp, setRepEmp]     = useState('');
  const [repDept, setRepDept]   = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  // ── Load employees ──
  const loadEmployees = async () => {
    setEmpLoading(true);
    try { setEmployees(await payrollApi.getEmployees()); }
    catch { toast('error', 'خطأ في جلب بيانات الموظفين'); }
    finally { setEmpLoading(false); }
  };

  // ── Load payroll records ──
  const loadPayroll = async () => {
    setPayLoading(true);
    try { setPayRecords(await payrollApi.getRecords({ month: payMonth, year: payYear })); }
    catch { toast('error', 'خطأ في جلب كشف الرواتب'); }
    finally { setPayLoading(false); }
  };

  // ── Load report ──
  const loadReport = async () => {
    setRepLoading(true);
    try { setReport(await payrollApi.getReport({ month: repMonth, year: repYear })); }
    catch { toast('error', 'خطأ في جلب التقرير'); }
    finally { setRepLoading(false); }
  };

  useEffect(() => { loadEmployees(); }, []);
  useEffect(() => { if (tab === 'payroll') loadPayroll(); }, [tab, payMonth, payYear]);
  useEffect(() => { if (tab === 'reports') loadReport(); }, [tab, repMonth, repYear]);

  // ── Employee CRUD ──
  const handleSaveEmp = async (data: Omit<EmployeeRecord, 'id' | 'created_at' | 'updated_at'>) => {
    if (!data.employee_code.trim() || !data.employee_name.trim()) {
      toast('error', 'كود الموظف والاسم مطلوبان'); return;
    }
    setEmpSaving(true);
    try {
      if (empModal === 'add') {
        const emp = await payrollApi.addEmployee(data);
        setEmployees(p => [...p, emp]);
        toast('success', 'تم إضافة الموظف بنجاح');
      } else if (editEmp) {
        const emp = await payrollApi.updateEmployee(editEmp.id, data);
        setEmployees(p => p.map(e => e.id === emp.id ? emp : e));
        toast('success', 'تم تعديل بيانات الموظف');
      }
      setEmpModal(null); setEditEmp(null);
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في الحفظ');
    } finally { setEmpSaving(false); }
  };

  const handleDelEmp = async () => {
    if (!delEmpId) return;
    try {
      await payrollApi.removeEmployee(delEmpId);
      setEmployees(p => p.filter(e => e.id !== delEmpId));
      toast('success', 'تم حذف الموظف');
    } catch { toast('error', 'خطأ في الحذف'); }
    finally { setDelEmpId(null); }
  };

  // ── Payroll generate ──
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await payrollApi.generate(payMonth, payYear);
      await loadPayroll();
      toast('success', `تم توليد ${res.generated} سجل راتب`);
    } catch { toast('error', 'خطأ في توليد كشف الرواتب'); }
    finally { setGenerating(false); }
  };

  // ── Payroll record save ──
  const handleSaveRec = async (data: Partial<PayrollRecordFull>) => {
    if (!editRec) return;
    setRecSaving(true);
    try {
      const updated = await payrollApi.updateRecord(editRec.id, data);
      setPayRecords(p => p.map(r => r.id === updated.id ? updated : r));
      toast('success', 'تم حفظ الراتب');
      setEditRec(null);
    } catch { toast('error', 'خطأ في الحفظ'); }
    finally { setRecSaving(false); }
  };

  // ── Filters ──
  const depts = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const filteredEmps = employees.filter(e =>
    (!empSearch || e.employee_name.includes(empSearch) || e.employee_code.includes(empSearch))
  );
  const filteredPay = payRecords.filter(r =>
    (!paySearch || r.employee.employee_name.includes(paySearch) || r.employee.employee_code.includes(paySearch)) &&
    (!payDept   || r.employee.department === payDept)
  );
  const reportRecords = (report?.records ?? []).filter(r =>
    (!repEmp  || r.employee.employee_name.includes(repEmp)) &&
    (!repDept || r.employee.department === repDept)
  );

  // ── Excel export (payroll) ──
  const exportPayrollExcel = () => {
    const rows = filteredPay.map(r => ({
      'كود الموظف':     r.employee.employee_code,
      'اسم الموظف':     r.employee.employee_name,
      'الإدارة':         r.employee.department,
      'نوع الموظف':     r.employee_type === 'fixed' ? 'راتب ثابت' : 'بالقطعة',
      'الراتب الأساسي / دخل القطعة': r.employee_type === 'fixed' ? r.employee.base_salary : r.piece_income,
      'المكافأة':        r.employee_type === 'fixed' ? r.bonus : r.production_bonus,
      'السلف':           r.advances,
      'الخصومات':        r.absence_deduction + r.additional_deductions,
      'صافي الراتب':    r.net_salary,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'كشف الرواتب');
    XLSX.writeFile(wb, `رواتب_${MONTHS[payMonth - 1]}_${payYear}.xlsx`);
  };

  // ── Print payroll sheet ──
  const printPayroll = () => {
    const rows = filteredPay.map(r => `
      <tr>
        <td>${r.employee.employee_code}</td>
        <td>${r.employee.employee_name}</td>
        <td>${r.employee.department}</td>
        <td>${r.employee_type === 'fixed' ? 'راتب ثابت' : 'بالقطعة'}</td>
        <td>${fmt(r.employee_type === 'fixed' ? r.employee.base_salary : r.piece_income)}</td>
        <td>${fmt(r.employee_type === 'fixed' ? r.bonus : r.production_bonus)}</td>
        <td>${fmt(r.advances)}</td>
        <td>${fmt(r.absence_deduction + r.additional_deductions)}</td>
        <td><strong>${fmt(r.net_salary)}</strong></td>
      </tr>`).join('');
    const html = `<html dir="rtl"><head><meta charset="utf-8"/><title>كشف رواتب</title>
    <style>body{font-family:Arial;padding:20px;font-size:12px}h2{text-align:center}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:5px;text-align:right}
    th{background:#1e3a5f;color:white}</style></head><body>
    <h2>كشف رواتب — ${MONTHS[payMonth - 1]} ${payYear}</h2>
    <table><thead><tr><th>الكود</th><th>الاسم</th><th>الإدارة</th><th>النوع</th>
    <th>الراتب/دخل القطعة</th><th>مكافأة</th><th>سلف</th><th>خصومات</th><th>الصافي</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); w.close(); }, 400);
  };

  // ── Excel export (report) ──
  const exportReportExcel = () => {
    if (!report) return;
    const rows = reportRecords.map(r => ({
      'الموظف': r.employee.employee_name,
      'الإدارة': r.employee.department,
      'صافي الراتب': r.net_salary,
      'سلف': r.advances,
      'خصومات': r.absence_deduction + r.additional_deductions,
      'مكافأة': r.bonus + r.production_bonus,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير الرواتب');
    XLSX.writeFile(wb, `تقرير_رواتب_${MONTHS[repMonth - 1]}_${repYear}.xlsx`);
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المرتبات</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة رواتب الموظفين وكشوف المرتبات</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { id: 'employees', label: 'الموظفون', icon: <Users size={16}/> },
          { id: 'payroll',   label: 'كشف الرواتب', icon: <FileText size={16}/> },
          { id: 'reports',   label: 'التقارير', icon: <BarChart2 size={16}/> },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === t.id ? 'bg-white text-[#1e3a5f] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ═══ EMPLOYEES TAB ═══ */}
      {tab === 'employees' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="بحث بالاسم أو الكود..."
                className="pr-10 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-56" />
            </div>
            <button onClick={() => { setEmpModal('add'); setEditEmp(null); }}
              className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2 rounded-xl hover:bg-[#16304d] transition text-sm font-medium">
              <Plus size={16}/> إضافة موظف
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>{['الكود','الاسم','الإدارة','النوع','الراتب/سعر القطعة','الحالة','إجراءات'].map(h => (
                    <th key={h} className="px-4 py-3 text-right font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {empLoading ? (
                    <tr><td colSpan={7} className="py-12 text-center text-gray-400">جارٍ التحميل...</td></tr>
                  ) : filteredEmps.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-gray-400">لا يوجد موظفون</td></tr>
                  ) : filteredEmps.map((emp, i) => (
                    <tr key={emp.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 font-mono">{emp.employee_code}</td>
                      <td className="px-4 py-3 font-medium">{emp.employee_name}</td>
                      <td className="px-4 py-3 text-gray-600">{emp.department}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          emp.employee_type === 'fixed' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {emp.employee_type === 'fixed' ? 'راتب ثابت' : 'بالقطعة'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-left font-medium">
                        {emp.employee_type === 'fixed' ? `${fmt(emp.base_salary)} ج.م` : `${fmt(emp.piece_rate)} ج.م/قطعة`}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {emp.status === 'active' ? 'نشط' : 'غير نشط'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => { setEditEmp(emp); setEmpModal('edit'); }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="تعديل">
                            <Edit2 size={15}/>
                          </button>
                          <button onClick={() => setDelEmpId(emp.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition" title="حذف">
                            <Trash2 size={15}/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PAYROLL TAB ═══ */}
      {tab === 'payroll' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-2 items-center flex-wrap">
              <select value={payMonth} onChange={e => setPayMonth(parseInt(e.target.value))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={payYear} onChange={e => setPayYear(parseInt(e.target.value))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="relative">
                <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input value={paySearch} onChange={e => setPaySearch(e.target.value)} placeholder="بحث..."
                  className="pr-9 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-40"/>
              </div>
              <div className="relative">
                <ChevronDown size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                <select value={payDept} onChange={e => setPayDept(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] pl-9">
                  <option value="">كل الإدارات</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleGenerate} disabled={generating}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-xl hover:bg-green-700 transition text-sm font-medium disabled:opacity-60">
                <Plus size={16}/>{generating ? 'جارٍ التوليد...' : 'توليد كشف الرواتب'}
              </button>
              <button onClick={exportPayrollExcel}
                className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-xl hover:bg-emerald-700 transition text-sm">
                <Download size={15}/> Excel
              </button>
              <button onClick={printPayroll}
                className="flex items-center gap-2 bg-gray-600 text-white px-3 py-2 rounded-xl hover:bg-gray-700 transition text-sm">
                <Printer size={15}/> طباعة
              </button>
            </div>
          </div>

          {/* Summary bar */}
          {filteredPay.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'إجمالي الرواتب', val: filteredPay.reduce((s, r) => s + r.net_salary, 0), color: 'text-blue-700' },
                { label: 'إجمالي السلف', val: filteredPay.reduce((s, r) => s + r.advances, 0), color: 'text-orange-700' },
                { label: 'إجمالي الخصومات', val: filteredPay.reduce((s, r) => s + r.absence_deduction + r.additional_deductions, 0), color: 'text-red-700' },
                { label: 'إجمالي المكافآت', val: filteredPay.reduce((s, r) => s + r.bonus + r.production_bonus, 0), color: 'text-green-700' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl p-3 shadow-sm">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-lg font-bold ${s.color}`}>{fmt(s.val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e3a5f] text-white">
                  <tr>{['الكود','الاسم','الإدارة','النوع','الراتب/دخل القطعة','مكافأة','سلف','خصومات','الصافي','إجراءات'].map(h => (
                    <th key={h} className="px-3 py-3 text-right font-medium whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {payLoading ? (
                    <tr><td colSpan={10} className="py-12 text-center text-gray-400">جارٍ التحميل...</td></tr>
                  ) : filteredPay.length === 0 ? (
                    <tr><td colSpan={10} className="py-12 text-center text-gray-400">
                      لا يوجد سجلات — اضغط "توليد كشف الرواتب" لإنشاء السجلات
                    </td></tr>
                  ) : filteredPay.map((rec, i) => {
                    const isFixed = rec.employee.employee_type === 'fixed';
                    return (
                      <tr key={rec.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2.5 font-mono text-xs">{rec.employee.employee_code}</td>
                        <td className="px-3 py-2.5 font-medium">{rec.employee.employee_name}</td>
                        <td className="px-3 py-2.5 text-gray-500 text-xs">{rec.employee.department}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${isFixed ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {isFixed ? 'ثابت' : 'قطعة'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-left">{fmt(isFixed ? rec.employee.base_salary : rec.piece_income)}</td>
                        <td className="px-3 py-2.5 text-left text-green-700">{fmt(isFixed ? rec.bonus : rec.production_bonus)}</td>
                        <td className="px-3 py-2.5 text-left text-orange-600">{fmt(rec.advances)}</td>
                        <td className="px-3 py-2.5 text-left text-red-600">{fmt(rec.absence_deduction + rec.additional_deductions)}</td>
                        <td className="px-3 py-2.5 text-left font-bold text-blue-800">{fmt(rec.net_salary)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1">
                            <button onClick={() => setEditRec(rec)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="تعديل">
                              <Edit2 size={14}/>
                            </button>
                            <button onClick={() => printReceipt(rec)}
                              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition" title="طباعة إيصال">
                              <Printer size={14}/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══ REPORTS TAB ═══ */}
      {tab === 'reports' && (
        <div className="space-y-4" ref={printRef}>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex gap-2 items-center flex-wrap">
              <select value={repMonth} onChange={e => setRepMonth(parseInt(e.target.value))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={repYear} onChange={e => setRepYear(parseInt(e.target.value))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]">
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="relative">
                <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input value={repEmp} onChange={e => setRepEmp(e.target.value)} placeholder="فلترة بالموظف..."
                  className="pr-9 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] w-44"/>
              </div>
              <div className="relative">
                <ChevronDown size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
                <select value={repDept} onChange={e => setRepDept(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] pl-9">
                  <option value="">كل الإدارات</option>
                  {depts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={exportReportExcel}
                className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-2 rounded-xl hover:bg-emerald-700 transition text-sm">
                <Download size={15}/> Excel
              </button>
              <button onClick={() => window.print()}
                className="flex items-center gap-2 bg-gray-600 text-white px-3 py-2 rounded-xl hover:bg-gray-700 transition text-sm">
                <Printer size={15}/> طباعة
              </button>
            </div>
          </div>

          {/* Summary cards */}
          {report && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'إجمالي الرواتب', val: report.total_salaries, color: 'from-blue-500 to-blue-700' },
                { label: 'إجمالي السلف', val: report.total_advances, color: 'from-orange-500 to-orange-700' },
                { label: 'إجمالي الخصومات', val: report.total_deductions, color: 'from-red-500 to-red-700' },
                { label: 'إجمالي المكافآت', val: report.total_bonuses, color: 'from-green-500 to-green-700' },
                { label: 'صافي المرتبات', val: report.net_payroll, color: 'from-[#1e3a5f] to-[#2d5a8f]' },
              ].map(s => (
                <div key={s.label} className={`bg-gradient-to-br ${s.color} text-white rounded-2xl p-4 shadow`}>
                  <p className="text-xs text-white/70">{s.label}</p>
                  <p className="text-xl font-bold mt-1">{fmt(s.val)}</p>
                  <p className="text-xs text-white/50">ج.م</p>
                </div>
              ))}
            </div>
          )}

          {/* Detail table */}
          {repLoading ? (
            <div className="py-12 text-center text-gray-400">جارٍ التحميل...</div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">تفاصيل الرواتب — {MONTHS[repMonth - 1]} {repYear}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>{['الموظف','الإدارة','النوع','الراتب/دخل القطعة','مكافأة','سلف','خصومات','الصافي'].map(h => (
                      <th key={h} className="px-4 py-3 text-right font-medium text-gray-600">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {reportRecords.length === 0 ? (
                      <tr><td colSpan={8} className="py-10 text-center text-gray-400">لا يوجد بيانات</td></tr>
                    ) : reportRecords.map((rec, i) => {
                      const isFixed = rec.employee.employee_type === 'fixed';
                      return (
                        <tr key={rec.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2.5 font-medium">{rec.employee.employee_name}</td>
                          <td className="px-4 py-2.5 text-gray-500">{rec.employee.department}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-1.5 py-0.5 rounded text-xs ${isFixed ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                              {isFixed ? 'ثابت' : 'قطعة'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-left">{fmt(isFixed ? rec.employee.base_salary : rec.piece_income)}</td>
                          <td className="px-4 py-2.5 text-left text-green-700">{fmt(isFixed ? rec.bonus : rec.production_bonus)}</td>
                          <td className="px-4 py-2.5 text-left text-orange-600">{fmt(rec.advances)}</td>
                          <td className="px-4 py-2.5 text-left text-red-600">{fmt(rec.absence_deduction + rec.additional_deductions)}</td>
                          <td className="px-4 py-2.5 text-left font-bold text-blue-800">{fmt(rec.net_salary)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {reportRecords.length > 0 && (
                    <tfoot className="bg-[#1e3a5f] text-white">
                      <tr>
                        <td colSpan={4} className="px-4 py-2.5 font-bold">الإجمالي</td>
                        <td className="px-4 py-2.5 text-left font-bold">{fmt(reportRecords.reduce((s, r) => s + r.bonus + r.production_bonus, 0))}</td>
                        <td className="px-4 py-2.5 text-left font-bold">{fmt(reportRecords.reduce((s, r) => s + r.advances, 0))}</td>
                        <td className="px-4 py-2.5 text-left font-bold">{fmt(reportRecords.reduce((s, r) => s + r.absence_deduction + r.additional_deductions, 0))}</td>
                        <td className="px-4 py-2.5 text-left font-bold">{fmt(reportRecords.reduce((s, r) => s + r.net_salary, 0))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ MODALS ═══ */}

      {/* Add/Edit Employee */}
      <Modal isOpen={!!empModal} onClose={() => { setEmpModal(null); setEditEmp(null); }}
        title={empModal === 'add' ? 'إضافة موظف جديد' : 'تعديل بيانات الموظف'}>
        <EmployeeForm
          initial={editEmp ? {
            employee_code: editEmp.employee_code, employee_name: editEmp.employee_name,
            department: editEmp.department, job_title: editEmp.job_title,
            employee_type: editEmp.employee_type, base_salary: editEmp.base_salary,
            piece_category: editEmp.piece_category, piece_rate: editEmp.piece_rate,
            status: editEmp.status, notes: editEmp.notes,
          } : EMPTY_EMP}
          onSave={handleSaveEmp} onCancel={() => { setEmpModal(null); setEditEmp(null); }}
          loading={empSaving}
        />
      </Modal>

      {/* Delete Employee Confirm */}
      <Modal isOpen={!!delEmpId} onClose={() => setDelEmpId(null)} title="تأكيد الحذف">
        <div className="space-y-4 p-1">
          <p className="text-gray-700">هل أنت متأكد من حذف هذا الموظف؟ سيتم حذف جميع سجلات راتبه أيضاً.</p>
          <div className="flex gap-3">
            <button onClick={handleDelEmp} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 transition">
              حذف
            </button>
            <button onClick={() => setDelEmpId(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* Edit Payroll Record */}
      <Modal isOpen={!!editRec} onClose={() => setEditRec(null)} title="تعديل بيانات الراتب">
        {editRec && (
          <PayrollEditForm rec={editRec} onSave={handleSaveRec} onCancel={() => setEditRec(null)} loading={recSaving} />
        )}
      </Modal>

      {/* Receipt Preview confirm (print happens inline via printReceipt fn) */}
      {printRec && (
        <Modal isOpen={true} onClose={() => setPrintRec(null)} title="طباعة إيصال راتب">
          <div className="space-y-3 p-1">
            <p>هل تريد طباعة إيصال راتب <strong>{printRec.employee.employee_name}</strong> لشهر {MONTHS[printRec.month - 1]} {printRec.year}؟</p>
            <div className="flex gap-3">
              <button onClick={() => { printReceipt(printRec); setPrintRec(null); }}
                className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition flex items-center justify-center gap-2">
                <Printer size={16}/> طباعة
              </button>
              <button onClick={() => setPrintRec(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

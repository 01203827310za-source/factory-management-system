import { useState, useEffect, useMemo } from 'react';
import { debtsStore, paymentLogStore } from '../data/store';
import type { Debt } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw, Banknote } from 'lucide-react';
import * as XLSX from 'xlsx';
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
export default function Debts() {
  const toast = useToast();
  const [items, setItems] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Debt | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [paymentModal, setPaymentModal] = useState<Debt | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentBy, setPaymentBy] = useState<'حاتم' | 'ميدو' | ''>('');
  const emptyForm = { date: '', name: '', total_amount: 0, amount_paid: 0 };
  const [form, setForm] = useState(emptyForm);
  const loadData = async () => { setLoading(true); try { setItems(await debtsStore.getAll()); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setLoading(false); } };
  useEffect(() => { loadData(); }, []);
  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: Debt) => { setEditItem(item); setForm({ date: item.date, name: item.name, total_amount: item.total_amount, amount_paid: item.amount_paid }); setModalOpen(true); };
  const handleSave = async () => {
    if (!form.name) { toast('error', 'يرجى كتابة الاسم'); return; }
    setSaving(true);
    try {
      const data = { date: form.date, name: form.name, total_amount: form.total_amount, amount_paid: form.amount_paid };
      if (editItem) { await debtsStore.update(editItem.id, data); toast('success', 'تم التعديل'); }
      else { await debtsStore.add(data); toast('success', 'تم الإضافة'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setSaving(false); }
  };
  const handlePayment = async (item: Debt) => {
    if (!paymentBy) { toast('error', 'يرجى تحديد من حول المبلغ'); return; }
    if (paymentAmount <= 0) { toast('error', 'يرجى إدخال مبلغ صحيح'); return; }
    setSaving(true);
    try {
      await debtsStore.update(item.id, { amount_paid: item.amount_paid + paymentAmount });
      await paymentLogStore.add({ date: new Date().toISOString().split('T')[0], type: 'debt_payment', amount: paymentAmount, receiver: paymentBy, description: `سداد دين: ${item.name}` });
      toast('success', `تم تسجيل دفعة بقيمة ${paymentAmount.toLocaleString('ar-EG')} من ${paymentBy}`);
      setPaymentModal(null); setPaymentAmount(0); setPaymentBy('');
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setSaving(false); }
  };
  const handleDelete = async (id: number) => { try { await debtsStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } };
  const filtered = useMemo(() => { if (!search) return items; const q = search.toLowerCase(); return items.filter(r => r.name.toLowerCase().includes(q)); }, [items, search]);
  const totalRemaining = items.reduce((s, d) => s + d.remaining, 0);
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(items.map(r => ({ 'التاريخ': r.date, 'الاسم': r.name, 'الإجمالي': r.total_amount, 'المدفوع': r.amount_paid, 'المتبقي': r.remaining }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'الديون'); XLSX.writeFile(wb, 'debts_export.xlsx'); };
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">💳 الديون</h1><p className="text-sm text-gray-500">متابعة الديون والمستحقات</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة دين</button>
        </div>
      </div>
      {totalRemaining > 0 && <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between"><span className="font-medium text-red-700">إجمالي المتبقي من الديون</span><span className="text-xl font-bold text-red-700">{totalRemaining.toLocaleString('ar-EG')}</span></div>}
      <div className="relative max-w-md"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالاسم..." className={`w-full pr-10 ${ic}`} /></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="bg-[#1e3a5f] text-white">{['#','التاريخ','الاسم','الإجمالي','المدفوع','المتبقي','الحالة','إجراءات'].map(h => <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
            {filtered.map((item, idx) => (
              <tr key={item.id} className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${item.remaining > 0 ? 'bg-red-50/30' : ''}`}>
                <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                <td className="px-4 py-3 text-center">{item.date}</td>
                <td className="px-4 py-3 font-medium">{item.name}</td>
                <td className="px-4 py-3 text-center">{item.total_amount.toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3 text-center text-emerald-600">{item.amount_paid.toLocaleString('ar-EG')}</td>
                <td className={`px-4 py-3 text-center font-bold ${item.remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{item.remaining.toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.remaining === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{item.remaining === 0 ? 'مسدد' : 'متبقي'}</span></td>
                <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1">
                  {item.remaining > 0 && <button onClick={() => { setPaymentModal(item); setPaymentAmount(0); setPaymentBy(''); }} className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg" title="تسجيل دفعة"><Banknote size={15} /></button>}
                  <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الدين' : 'إضافة دين جديد'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>الاسم *</label><input className={ic} value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
          <div><label className={lc}>الإجمالي</label><input type="number" className={ic} value={form.total_amount} onChange={e => setForm({...form, total_amount: parseFloat(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>المدفوع</label><input type="number" className={ic} value={form.amount_paid} onChange={e => setForm({...form, amount_paid: parseFloat(e.target.value)||0})} min={0} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>
      {paymentModal && <Modal isOpen={true} onClose={() => setPaymentModal(null)} title={`تسجيل دفعة - ${paymentModal.name}`}>
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm"><span className="text-gray-600">المتبقي: </span><span className="font-bold text-red-600">{paymentModal.remaining.toLocaleString('ar-EG')}</span></div>
          <div><label className={lc}>مبلغ الدفعة</label><input type="number" className={ic} value={paymentAmount} onChange={e => setPaymentAmount(parseFloat(e.target.value)||0)} min={0} max={paymentModal.remaining} /></div>
          <div><label className={lc}>من حول المبلغ</label><select className={ic} value={paymentBy} onChange={e => setPaymentBy(e.target.value as 'حاتم' | 'ميدو' | '')}><option value="">اختر</option><option value="حاتم">حاتم</option><option value="ميدو">ميدو</option></select></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setPaymentModal(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={() => handlePayment(paymentModal)} disabled={saving} className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'تسجيل الدفعة'}</button>
        </div>
      </Modal>}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد؟</p>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button><button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button></div>
      </Modal>
    </div>
  );
}
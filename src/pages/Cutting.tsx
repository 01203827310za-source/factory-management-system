import { useState, useEffect, useMemo } from 'react';
import { cuttingStore } from '../data/store';
import type { CuttingOrder } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
export default function Cutting() {
  const toast = useToast();
  const [items, setItems] = useState<CuttingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<CuttingOrder | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { date: '', cut_number: 0, cut_description: '', material_type: '', layers_count: 0, spread_length_m: 0, total_pieces: 0, color: '', kg_consumed: 0, notes: '' };
  const [form, setForm] = useState(emptyForm);
  const loadData = async () => { setLoading(true); try { setItems(await cuttingStore.getAll()); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setLoading(false); } };
  useEffect(() => { loadData(); }, []);
  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: CuttingOrder) => { setEditItem(item); setForm({ date: item.date, cut_number: item.cut_number, cut_description: item.cut_description, material_type: item.material_type, layers_count: item.layers_count, spread_length_m: item.spread_length_m, total_pieces: item.total_pieces, color: item.color, kg_consumed: item.kg_consumed, notes: item.notes }); setModalOpen(true); };
  const handleSave = async () => {
    if (!form.cut_number || !form.cut_description) { toast('error', 'يرجى ملء رقم القصة والبيان'); return; }
    setSaving(true);
    try {
      if (editItem) { await cuttingStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await cuttingStore.add(form); toast('success', 'تم الإضافة — تم تحديث مخزن القماش'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setSaving(false); }
  };
  const handleDelete = async (id: number) => { try { await cuttingStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } };
  const filtered = useMemo(() => { if (!search) return items; const q = search.toLowerCase(); return items.filter(r => r.cut_description.toLowerCase().includes(q) || r.material_type.toLowerCase().includes(q) || String(r.cut_number).includes(q)); }, [items, search]);
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(items.map(r => ({ 'التاريخ': r.date, 'رقم القصة': r.cut_number, 'البيان': r.cut_description, 'نوع الخامة': r.material_type, 'عدد الرقات': r.layers_count, 'طول الفرشة': r.spread_length_m, 'إجمالي القطع': r.total_pieces, 'الألوان': r.color, 'كيلوهات': r.kg_consumed, 'ملاحظات': r.notes }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'القص'); XLSX.writeFile(wb, 'cutting_export.xlsx'); };
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">✂️ رقم القص</h1><p className="text-sm text-gray-500">إدارة عمليات القص والخامات</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة قصة</button>
        </div>
      </div>
      <div className="relative max-w-md"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث برقم القصة، البيان..." className={`w-full pr-10 ${ic}`} /></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="bg-[#1e3a5f] text-white">{['#','التاريخ','رقم القصة','البيان','نوع الخامة','عدد الرقات','طول الفرشة (م)','القطع','اللون','كجم','ملاحظات','إجراءات'].map(h => <th key={h} className="px-3 py-3 text-center font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={12} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={12} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
            {filtered.map((item, idx) => (
              <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/40 transition">
                <td className="px-3 py-3 text-center text-gray-500">{idx + 1}</td>
                <td className="px-3 py-3 text-center">{item.date}</td>
                <td className="px-3 py-3 text-center font-bold">{item.cut_number}</td>
                <td className="px-3 py-3">{item.cut_description}</td>
                <td className="px-3 py-3 text-center">{item.material_type}</td>
                <td className="px-3 py-3 text-center">{item.layers_count}</td>
                <td className="px-3 py-3 text-center">{item.spread_length_m}</td>
                <td className="px-3 py-3 text-center font-semibold">{item.total_pieces}</td>
                <td className="px-3 py-3 text-center">{item.color}</td>
                <td className="px-3 py-3 text-center text-red-600 font-semibold">{item.kg_consumed}</td>
                <td className="px-3 py-3 text-center text-xs">{item.notes || '-'}</td>
                <td className="px-3 py-3 text-center"><div className="flex items-center justify-center gap-1">
                  <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل القصة' : 'إضافة قصة جديدة'} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>رقم القصة *</label><input type="number" className={ic} value={form.cut_number} onChange={e => setForm({...form, cut_number: parseInt(e.target.value)||0})} /></div>
          <div className="md:col-span-2"><label className={lc}>بيان القصة *</label><input className={ic} value={form.cut_description} onChange={e => setForm({...form, cut_description: e.target.value})} /></div>
          <div><label className={lc}>نوع الخامة</label><input className={ic} value={form.material_type} onChange={e => setForm({...form, material_type: e.target.value})} /></div>
          <div><label className={lc}>اللون</label><input className={ic} value={form.color} onChange={e => setForm({...form, color: e.target.value})} /></div>
          <div><label className={lc}>عدد الرقات</label><input type="number" className={ic} value={form.layers_count} onChange={e => setForm({...form, layers_count: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>طول الفرشة (م)</label><input type="number" className={ic} value={form.spread_length_m} onChange={e => setForm({...form, spread_length_m: parseFloat(e.target.value)||0})} min={0} step="0.1" /></div>
          <div><label className={lc}>إجمالي القطع</label><input type="number" className={ic} value={form.total_pieces} onChange={e => setForm({...form, total_pieces: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>الكيلوجرامات المستهلكة</label><input type="number" className={ic} value={form.kg_consumed} onChange={e => setForm({...form, kg_consumed: parseFloat(e.target.value)||0})} min={0} step="0.1" /></div>
          <div className="md:col-span-2"><label className={lc}>ملاحظات</label><input className={ic} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد؟</p>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button><button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button></div>
      </Modal>
    </div>
  );
}
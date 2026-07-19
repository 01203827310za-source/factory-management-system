import { useState, useEffect, useMemo } from 'react';
import { accessoriesStore } from '../data/store';
import type { AccessoriesWarehouse, ComputedAccessories } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useCrudPermissions } from '../hooks/usePermissions';
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
export default function Accessories() {
  const toast = useToast();
  const { canCreate, canEdit, canDelete } = useCrudPermissions('accessories');
  const [items, setItems] = useState<ComputedAccessories[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<AccessoriesWarehouse | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { date: '', item_name: '', qty_in: 0, qty_consumed: 0, cost: 0 };
  const [form, setForm] = useState(emptyForm);
  const loadData = async () => { setLoading(true); try { setItems(await accessoriesStore.getComputed()); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setLoading(false); } };
  useEffect(() => { loadData(); }, []);
  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: AccessoriesWarehouse) => { setEditItem(item); setForm({ date: item.date, item_name: item.item_name, qty_in: item.qty_in, qty_consumed: item.qty_consumed, cost: item.cost }); setModalOpen(true); };
  const handleSave = async () => {
    if (!form.item_name) { toast('error', 'يرجى كتابة اسم الصنف'); return; }
    setSaving(true);
    try {
      if (editItem) { await accessoriesStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await accessoriesStore.add(form); toast('success', 'تم الإضافة'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setSaving(false); }
  };
  const handleDelete = async (id: number) => { try { await accessoriesStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } };
  const filtered = useMemo(() => { if (!search) return items; const q = search.toLowerCase(); return items.filter(r => r.item_name.toLowerCase().includes(q)); }, [items, search]);
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(items.map(r => ({ 'التاريخ': r.date, 'الصنف': r.item_name, 'واردة': r.qty_in, 'مستهلكة': r.qty_consumed, 'الرصيد': r.available_balance, 'التكلفة': r.cost }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'الإكسسوارات'); XLSX.writeFile(wb, 'accessories_export.xlsx'); };
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">🪡 مخزن الإكسسوارات</h1><p className="text-sm text-gray-500">إدارة الأزرار، الخيوط، السوستات...</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          {canCreate && <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة</button>}
        </div>
      </div>
      <div className="relative max-w-md"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث باسم الصنف..." className={`w-full pr-10 ${ic}`} /></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="bg-[#1e3a5f] text-white">{['#','التاريخ','الصنف','كمية واردة','مستهلكة','الرصيد المتاح 🔄','التكلفة','إجراءات'].map(h => <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
            {filtered.map((item, idx) => (
              <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/40 transition">
                <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                <td className="px-4 py-3 text-center">{item.date}</td>
                <td className="px-4 py-3 font-medium">{item.item_name}</td>
                <td className="px-4 py-3 text-center text-emerald-600">{item.qty_in.toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3 text-center text-red-600">{item.qty_consumed.toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3 text-center font-bold">{item.available_balance.toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3 text-center">{item.cost.toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1">
                  {canEdit && <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>}
                  {canDelete && <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل' : 'إضافة صنف'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>اسم الصنف *</label><input className={ic} value={form.item_name} onChange={e => setForm({...form, item_name: e.target.value})} /></div>
          <div><label className={lc}>الكمية الواردة</label><input type="number" className={ic} value={form.qty_in} onChange={e => setForm({...form, qty_in: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>الكمية المستهلكة</label><input type="number" className={ic} value={form.qty_consumed} onChange={e => setForm({...form, qty_consumed: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>التكلفة</label><input type="number" className={ic} value={form.cost} onChange={e => setForm({...form, cost: parseFloat(e.target.value)||0})} min={0} /></div>
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

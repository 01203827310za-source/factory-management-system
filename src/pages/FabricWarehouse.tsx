import { useState, useEffect, useMemo } from 'react';
import { fabricStore } from '../data/store';
import type { FabricWarehouse, ComputedFabric } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";

export default function FabricWarehouse() {
  const toast = useToast();
  const [items, setItems] = useState<ComputedFabric[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<FabricWarehouse | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { date: '', material_type: '', color: '', qty_in: 0, cost_per_kg: 0 };
  const [form, setForm] = useState(emptyForm);

  const loadData = async () => {
    setLoading(true);
    try { setItems(await fabricStore.getComputed()); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: FabricWarehouse) => {
    setEditItem(item);
    setForm({ date: item.date, material_type: item.material_type, color: item.color, qty_in: item.qty_in, cost_per_kg: item.cost_per_kg });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.material_type) { toast('error', 'يرجى تحديد نوع المادة'); return; }
    setSaving(true);
    try {
      if (editItem) { await fabricStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await fabricStore.add(form); toast('success', 'تم الإضافة'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { await fabricStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(r => r.material_type.toLowerCase().includes(q) || r.color.toLowerCase().includes(q));
  }, [items, search]);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(r => ({ 'التاريخ': r.date, 'الصنف': r.material_type, 'اللون': r.color, 'كمية واردة': r.qty_in, 'مستهلكة': r.qty_consumed, 'الرصيد': r.available_balance, 'التكلفة/كجم': r.cost_per_kg })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'القماش'); XLSX.writeFile(wb, 'fabric_export.xlsx');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">🧵 مخزن القماش</h1><p className="text-sm text-gray-500">إدارة مواد القماش والخامات</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة وارد</button>
        </div>
      </div>
      <div className="relative max-w-md"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالنوع، اللون..." className={`w-full pr-10 ${ic}`} /></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="bg-[#1e3a5f] text-white">
              {['#','التاريخ','الصنف','اللون','كمية واردة (كجم)','مستهلكة 🔄','الرصيد المتاح 🔄','التكلفة/كجم','إجراءات'].map(h => <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
              {filtered.map((item, idx) => (
                <tr key={item.id} className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${item.available_balance < 5 ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                  <td className="px-4 py-3 text-center">{item.date}</td>
                  <td className="px-4 py-3 font-medium">{item.material_type}</td>
                  <td className="px-4 py-3 text-center">{item.color}</td>
                  <td className="px-4 py-3 text-center text-emerald-600">{item.qty_in.toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-3 text-center text-red-600">{item.qty_consumed.toLocaleString('ar-EG')}</td>
                  <td className={`px-4 py-3 text-center font-bold ${item.available_balance < 5 ? 'text-red-700' : 'text-gray-800'}`}>{item.available_balance.toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-3 text-center">{item.cost_per_kg.toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-3 text-center"><div className="flex items-center justify-center gap-1">
                    <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                    <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل' : 'إضافة وارد جديد'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>نوع الخامة *</label><input className={ic} value={form.material_type} onChange={e => setForm({...form, material_type: e.target.value})} placeholder="قطن، صوف..." /></div>
          <div><label className={lc}>اللون</label><input className={ic} value={form.color} onChange={e => setForm({...form, color: e.target.value})} /></div>
          <div><label className={lc}>الكمية (كجم)</label><input type="number" className={ic} value={form.qty_in} onChange={e => setForm({...form, qty_in: parseFloat(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>التكلفة / كجم</label><input type="number" className={ic} value={form.cost_per_kg} onChange={e => setForm({...form, cost_per_kg: parseFloat(e.target.value)||0})} min={0} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button>
        </div>
      </Modal>
    </div>
  );
}
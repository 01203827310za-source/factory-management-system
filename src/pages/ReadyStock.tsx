import { useState, useEffect, useMemo } from 'react';
import { readyStockStore } from '../data/store';
import type { ReadyStock, ComputedReadyStock } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";

export default function ReadyStock() {
  const toast = useToast();
  const [items, setItems] = useState<ComputedReadyStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ReadyStock | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { model_code: '', product_name: '', color: '', opening_balance: 0, cost_per_piece: 0, location: '', mido_stock: 0, hatem_stock: 0, reserved_quantity: 0 };
  const [form, setForm] = useState(emptyForm);

  const loadData = async () => {
    setLoading(true);
    try { setItems(await readyStockStore.getComputed()); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: ReadyStock) => {
    setEditItem(item);
    setForm({ model_code: item.model_code, product_name: item.product_name, color: item.color, opening_balance: item.opening_balance, cost_per_piece: item.cost_per_piece, location: item.location, mido_stock: item.mido_stock, hatem_stock: item.hatem_stock });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.model_code || !form.product_name) { toast('error', 'يرجى ملء كود الموديل واسم الصنف'); return; }
    setSaving(true);
    try {
      if (editItem) { await readyStockStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await readyStockStore.add(form); toast('success', 'تم الإضافة'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { await readyStockStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(r => r.model_code.toLowerCase().includes(q) || r.product_name.toLowerCase().includes(q) || r.color.toLowerCase().includes(q));
  }, [items, search]);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(r => ({ 'كود الموديل': r.model_code, 'اسم الصنف': r.product_name, 'اللون': r.color, 'رصيد أول': r.opening_balance, 'إنتاج جديد': r.new_production, 'إجمالي المبيعات': r.total_sales, 'المرتجعات': r.total_returns, 'الرصيد الفعلي': r.actual_balance, 'محجوز': r.reserved_quantity, 'المتاح': r.available_quantity, 'تكلفة القطعة': r.cost_per_piece, 'المكان': r.location })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'الاستوك'); XLSX.writeFile(wb, 'ready_stock_export.xlsx');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">📦 مخزن الاستوك الجاهز</h1><p className="text-sm text-gray-500">إدارة المخزون وإنتاج جديد مبيعات آلي</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة صنف</button>
        </div>
      </div>

      <div className="relative max-w-md"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالكود، الاسم، اللون..." className={`w-full pr-10 ${ic}`} /></div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="bg-[#1e3a5f] text-white">
              {['#','كود الموديل','اسم الصنف','اللون','رصيد أول','إنتاج جديد 🔄','إجمالي مبيعات 🔄','المرتجعات 🔄','الرصيد الفعلي 🔄','محجوز 🔒','المتاح ✅','تكلفة القطعة','المكان','إجراءات'].map(h => <th key={h} className="px-3 py-3 text-center font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={14} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={14} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
              {filtered.map((item, idx) => (
                <tr key={item.id} className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${item.available_quantity < 0 ? 'bg-red-100' : item.available_quantity < 3 ? 'bg-red-50' : item.available_quantity <= 10 ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-3 text-center text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-3 font-medium">{item.model_code}</td>
                  <td className="px-3 py-3">{item.product_name}</td>
                  <td className="px-3 py-3 text-center">{item.color}</td>
                  <td className="px-3 py-3 text-center">{item.opening_balance.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center font-semibold text-emerald-600">{item.new_production.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center text-red-600">{item.total_sales.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center text-emerald-600 font-semibold">{item.total_returns.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center font-bold text-gray-700">{item.actual_balance.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center">
                    {item.reserved_quantity > 0
                      ? <span className="inline-block bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5 rounded-full">{item.reserved_quantity.toLocaleString('ar-EG')}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`px-3 py-3 text-center font-bold ${item.available_quantity < 0 ? 'text-red-700 font-extrabold' : item.available_quantity < 3 ? 'text-red-600' : item.available_quantity <= 10 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {item.available_quantity.toLocaleString('ar-EG')}
                  </td>
                  <td className="px-3 py-3 text-center">{item.cost_per_piece.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center text-xs">{item.location}</td>
                  <td className="px-3 py-3 text-center"><div className="flex items-center justify-center gap-1">
                    <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                    <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الصنف' : 'إضافة صنف جديد'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>كود الموديل *</label><input className={ic} value={form.model_code} onChange={e => setForm({...form, model_code: e.target.value})} placeholder="M001" /></div>
          <div><label className={lc}>اسم الصنف *</label><input className={ic} value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} /></div>
          <div><label className={lc}>اللون</label><input className={ic} value={form.color} onChange={e => setForm({...form, color: e.target.value})} /></div>
          <div><label className={lc}>رصيد أول</label><input type="number" className={ic} value={form.opening_balance} onChange={e => setForm({...form, opening_balance: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>تكلفة القطعة</label><input type="number" className={ic} value={form.cost_per_piece} onChange={e => setForm({...form, cost_per_piece: parseFloat(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>المكان</label><select className={ic} value={form.location} onChange={e => setForm({...form, location: e.target.value})}><option value="">اختر</option><option value="مخزن ميدو">مخزن ميدو</option><option value="مخزن حاتم">مخزن حاتم</option></select></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذا الصنف؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">حذف</button>
        </div>
      </Modal>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { modelProdStore, cuttingStore, readyStockStore } from '../data/store';
import type { ModelProduction } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
const STATUSES: ModelProduction['status'][] = ['قيد التشغيل', 'تام', 'هالك'];
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
export default function ModelProduction() {
  const toast = useToast();
  const [items, setItems] = useState<ModelProduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ModelProduction | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [cutNumbers, setCutNumbers] = useState<number[]>([]);
  const [stockCodes, setStockCodes] = useState<string[]>([]);
  const [stockColors, setStockColors] = useState<Record<string, string[]>>({});
  const emptyForm = { date: '', cut_number: 0, model_code: '', qty_from_cutting: 0, model_description: '', color: '', sizes: '', status: 'تام' as ModelProduction['status'], wastage: 0, qty_received: 0, warehouse_entry_date: '' };
  const [form, setForm] = useState(emptyForm);
  const loadData = async () => {
    setLoading(true);
    try {
      const [prods, cuts, stock] = await Promise.all([modelProdStore.getAll(), cuttingStore.getAll(), readyStockStore.getAll()]);
      setItems(prods);
      setCutNumbers(cuts.map(c => c.cut_number));
      setStockCodes([...new Set(stock.map(s => s.model_code))]);
      const colors: Record<string, string[]> = {};
      stock.forEach(s => { if (!colors[s.model_code]) colors[s.model_code] = []; if (!colors[s.model_code].includes(s.color)) colors[s.model_code].push(s.color); });
      setStockColors(colors);
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);
  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: ModelProduction) => { setEditItem(item); setForm({ date: item.date, cut_number: item.cut_number, model_code: item.model_code, qty_from_cutting: item.qty_from_cutting, model_description: item.model_description, color: item.color, sizes: item.sizes, status: item.status, wastage: item.wastage, qty_received: item.qty_received, warehouse_entry_date: item.warehouse_entry_date }); setModalOpen(true); };
  const handleSave = async () => {
    if (!form.model_code) { toast('error', 'يرجى تحديد كود الموديل'); return; }
    setSaving(true);
    try {
      if (editItem) { await modelProdStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await modelProdStore.add(form); toast('success', 'تم الإضافة — تم تحديث مخزن الاستوك'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } finally { setSaving(false); }
  };
  const handleDelete = async (id: number) => { try { await modelProdStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); } };
  const filtered = useMemo(() => { if (!search) return items; const q = search.toLowerCase(); return items.filter(r => r.model_code.toLowerCase().includes(q) || r.model_description.toLowerCase().includes(q) || String(r.cut_number).includes(q)); }, [items, search]);
  const exportExcel = () => { const ws = XLSX.utils.json_to_sheet(items.map(r => ({ 'التاريخ': r.date, 'رقم القصة': r.cut_number, 'كود الموديل': r.model_code, 'عدد من القص': r.qty_from_cutting, 'الوصف': r.model_description, 'اللون': r.color, 'المقاسات': r.sizes, 'الحالة': r.status, 'الهالك': r.wastage, 'المستلم': r.qty_received, 'تاريخ المخزن': r.warehouse_entry_date }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'الموديلات'); XLSX.writeFile(wb, 'models_export.xlsx'); };
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">👕 رقم الموديل</h1><p className="text-sm text-gray-500">إدارة إنتاج الموديلات</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة موديل</button>
        </div>
      </div>
      <div className="relative max-w-md"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالكود، الوصف..." className={`w-full pr-10 ${ic}`} /></div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="bg-[#1e3a5f] text-white">{['#','التاريخ','رقم القصة','كود الموديل','من القص','الوصف','اللون','المقاسات','الحالة','الهالك','المستلم','المخزن','إجراءات'].map(h => <th key={h} className="px-3 py-3 text-center font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={13} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={13} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
            {filtered.map((item, idx) => (
              <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/40 transition">
                <td className="px-3 py-3 text-center text-gray-500">{idx + 1}</td>
                <td className="px-3 py-3 text-center">{item.date}</td>
                <td className="px-3 py-3 text-center font-bold">{item.cut_number}</td>
                <td className="px-3 py-3 font-medium">{item.model_code}</td>
                <td className="px-3 py-3 text-center">{item.qty_from_cutting}</td>
                <td className="px-3 py-3">{item.model_description}</td>
                <td className="px-3 py-3 text-center">{item.color}</td>
                <td className="px-3 py-3 text-center text-xs">{item.sizes}</td>
                <td className="px-3 py-3 text-center"><span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'تام' ? 'bg-emerald-100 text-emerald-700' : item.status === 'قيد التشغيل' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{item.status}</span></td>
                <td className="px-3 py-3 text-center text-red-600">{item.wastage}</td>
                <td className="px-3 py-3 text-center font-semibold text-emerald-600">{item.qty_received}</td>
                <td className="px-3 py-3 text-center text-xs">{item.warehouse_entry_date || '-'}</td>
                <td className="px-3 py-3 text-center"><div className="flex items-center justify-center gap-1">
                  <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الموديل' : 'إضافة موديل'} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>رقم القصة</label><select className={ic} value={form.cut_number} onChange={e => setForm({...form, cut_number: parseInt(e.target.value)||0})}><option value={0}>اختر</option>{cutNumbers.map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          <div><label className={lc}>كود الموديل *</label><select className={ic} value={form.model_code} onChange={e => setForm({...form, model_code: e.target.value})}><option value="">اختر</option>{stockCodes.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className={lc}>العدد من القص</label><input type="number" className={ic} value={form.qty_from_cutting} onChange={e => setForm({...form, qty_from_cutting: parseInt(e.target.value)||0})} min={0} /></div>
          <div className="md:col-span-2"><label className={lc}>وصف الموديل</label><input className={ic} value={form.model_description} onChange={e => setForm({...form, model_description: e.target.value})} /></div>
          <div><label className={lc}>اللون</label><select className={ic} value={form.color} onChange={e => setForm({...form, color: e.target.value})}><option value="">اختر</option>{(stockColors[form.model_code] || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label className={lc}>المقاسات</label><input className={ic} value={form.sizes} onChange={e => setForm({...form, sizes: e.target.value})} placeholder="S,M,L,XL" /></div>
          <div><label className={lc}>الحالة</label><select className={ic} value={form.status} onChange={e => setForm({...form, status: e.target.value as ModelProduction['status']})}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className={lc}>الهالك</label><input type="number" className={ic} value={form.wastage} onChange={e => setForm({...form, wastage: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>العدد المستلم (تام)</label><input type="number" className={ic} value={form.qty_received} onChange={e => setForm({...form, qty_received: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>تاريخ دخول المخزن</label><input type="date" className={ic} value={form.warehouse_entry_date} onChange={e => setForm({...form, warehouse_entry_date: e.target.value})} /></div>
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
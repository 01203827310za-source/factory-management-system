import { useState, useEffect, useMemo } from 'react';
import { expensesStore } from '../data/store';
import type { ExpenseRevenue } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { usePartners } from '../contexts/PartnerContext';

const OP_TYPES: ExpenseRevenue['operation_type'][] = ['راس مالى', 'مصروف تشغيل', 'ايراد مبيعات', 'استلاف', 'سداد'];
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";

export default function Expenses() {
  const toast = useToast();
  const { activePartners } = usePartners();
  const hatemActive = activePartners.length === 0 || activePartners.some(p => p.name === 'حاتم');
  const midoActive  = activePartners.length === 0 || activePartners.some(p => p.name === 'ميدو');
  const [items, setItems] = useState<ExpenseRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ExpenseRevenue | null>(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { date: '', operation_type: 'مصروف تشغيل' as ExpenseRevenue['operation_type'], statement: '', hatem_in: 0, hatem_out: 0, mido_in: 0, mido_out: 0 };
  const [form, setForm] = useState(emptyForm);

  const loadData = async () => {
    setLoading(true);
    try { setItems(await expensesStore.getAll()); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في التحميل'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: ExpenseRevenue) => {
    setEditItem(item);
    setForm({ date: item.date, operation_type: item.operation_type, statement: item.statement, hatem_in: item.hatem_in, hatem_out: item.hatem_out, mido_in: item.mido_in, mido_out: item.mido_out });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.statement) { toast('error', 'يرجى كتابة البيان'); return; }
    setSaving(true);
    try {
      if (editItem) { await expensesStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await expensesStore.add(form); toast('success', 'تم الإضافة'); }
      setModalOpen(false);
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { await expensesStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في الحذف'); }
  };

  const filtered = useMemo(() => {
    let r = items;
    if (filterType) r = r.filter(x => x.operation_type === filterType);
    if (filterDateFrom) r = r.filter(x => x.date >= filterDateFrom);
    if (filterDateTo) r = r.filter(x => x.date <= filterDateTo);
    if (search) { const q = search.toLowerCase(); r = r.filter(x => x.statement.toLowerCase().includes(q)); }
    return r;
  }, [items, filterType, filterDateFrom, filterDateTo, search]);

  const summary = useMemo(() => ({
    hatemIn: items.reduce((s, r) => s + r.hatem_in, 0),
    hatemOut: items.reduce((s, r) => s + r.hatem_out, 0),
    midoIn: items.reduce((s, r) => s + r.mido_in, 0),
    midoOut: items.reduce((s, r) => s + r.mido_out, 0),
    totalIn: items.reduce((s, r) => s + r.hatem_in + r.mido_in, 0),
    totalOut: items.reduce((s, r) => s + r.hatem_out + r.mido_out, 0),
  }), [items]);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({ 'التاريخ': r.date, 'نوع العملية': r.operation_type, 'البيان': r.statement, 'وارد حاتم': r.hatem_in, 'منصرف حاتم': r.hatem_out, 'وارد ميدو': r.mido_in, 'منصرف ميدو': r.mido_out })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'المصاريف'); XLSX.writeFile(wb, 'expenses_export.xlsx');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">💰 المصاريف والإيرادات</h1><p className="text-sm text-gray-500">تتبع الوارد والمنصرف</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ...(hatemActive ? [{ l: 'وارد حاتم', v: summary.hatemIn, c: 'emerald' }, { l: 'منصرف حاتم', v: summary.hatemOut, c: 'red' }] : []),
          ...(midoActive  ? [{ l: 'وارد ميدو',  v: summary.midoIn,  c: 'emerald' }, { l: 'منصرف ميدو',  v: summary.midoOut,  c: 'red' }] : []),
          { l: 'إجمالي الوارد', v: summary.totalIn, c: 'blue' },
        ].map(x => (
          <div key={x.l} className={`bg-${x.c}-50 border border-${x.c}-200 rounded-lg p-3 text-center`}>
            <p className={`text-[11px] text-${x.c}-600`}>{x.l}</p>
            <p className={`text-lg font-bold text-${x.c}-700`}>{x.v.toLocaleString('ar-EG')}</p>
          </div>
        ))}
        <div className={`${summary.totalIn - summary.totalOut >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'} rounded-lg p-3 text-center border`}>
          <p className={`text-[11px] ${summary.totalIn - summary.totalOut >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>صافي السيولة</p>
          <p className={`text-lg font-bold ${summary.totalIn - summary.totalOut >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{(summary.totalIn - summary.totalOut).toLocaleString('ar-EG')}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في البيان..." className={`w-full pr-10 ${ic}`} /></div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">كل العمليات</option>{OP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="bg-[#1e3a5f] text-white">
              {['#','التاريخ','نوع العملية','البيان','وارد حاتم','منصرف حاتم','وارد ميدو','منصرف ميدو','إجراءات'].map(h => <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
              {filtered.map((item, idx) => (
                <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/40 transition">
                  <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                  <td className="px-4 py-3 text-center">{item.date}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.operation_type === 'راس مالى' ? 'bg-purple-100 text-purple-700' : item.operation_type === 'مصروف تشغيل' ? 'bg-red-100 text-red-700' : item.operation_type === 'ايراد مبيعات' ? 'bg-emerald-100 text-emerald-700' : item.operation_type === 'استلاف' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{item.operation_type}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-right">{item.statement}</td>
                  <td className="px-4 py-3 text-center text-emerald-600">{item.hatem_in > 0 ? item.hatem_in.toLocaleString('ar-EG') : '-'}</td>
                  <td className="px-4 py-3 text-center text-red-600">{item.hatem_out > 0 ? item.hatem_out.toLocaleString('ar-EG') : '-'}</td>
                  <td className="px-4 py-3 text-center text-emerald-600">{item.mido_in > 0 ? item.mido_in.toLocaleString('ar-EG') : '-'}</td>
                  <td className="px-4 py-3 text-center text-red-600">{item.mido_out > 0 ? item.mido_out.toLocaleString('ar-EG') : '-'}</td>
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

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل' : 'إضافة عملية'} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>نوع العملية</label><select className={ic} value={form.operation_type} onChange={e => setForm({...form, operation_type: e.target.value as ExpenseRevenue['operation_type']})}>{OP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div className="md:col-span-2"><label className={lc}>البيان *</label><input className={ic} value={form.statement} onChange={e => setForm({...form, statement: e.target.value})} /></div>
          {hatemActive && <div><label className={lc}>وارد حاتم</label><input type="number" className={ic} value={form.hatem_in} onChange={e => setForm({...form, hatem_in: parseFloat(e.target.value)||0})} min={0} /></div>}
          {hatemActive && <div><label className={lc}>منصرف حاتم</label><input type="number" className={ic} value={form.hatem_out} onChange={e => setForm({...form, hatem_out: parseFloat(e.target.value)||0})} min={0} /></div>}
          {midoActive  && <div><label className={lc}>وارد ميدو</label><input type="number" className={ic} value={form.mido_in} onChange={e => setForm({...form, mido_in: parseFloat(e.target.value)||0})} min={0} /></div>}
          {midoActive  && <div><label className={lc}>منصرف ميدو</label><input type="number" className={ic} value={form.mido_out} onChange={e => setForm({...form, mido_out: parseFloat(e.target.value)||0})} min={0} /></div>}
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذا السجل؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">حذف</button>
        </div>
      </Modal>
    </div>
  );
}

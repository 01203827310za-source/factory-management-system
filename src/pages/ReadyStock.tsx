import { useState, useEffect, useMemo } from 'react';
import { readyStockStore } from '../data/store';
import { printOrdersApi } from '../services/api';
import type { ReadyStock, ComputedReadyStock, PrintOrder } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw, Printer, ChevronRight, ChevronLeft, History } from 'lucide-react';
import * as XLSX from 'xlsx';

const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';

const emptyPrint = () => ({
  // step 1
  source_stock_id: 0,
  qty_to_print: 0,
  date: new Date().toISOString().slice(0, 10),
  // step 2
  new_model_code: '',
  new_product_name: '',
  new_color: '',
  print_type: '',
  print_cost_per_piece: 0,
  notes: '',
});

export default function ReadyStock() {
  const toast = useToast();
  const [items, setItems] = useState<ComputedReadyStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ReadyStock | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { model_code: '', product_name: '', color: '', opening_balance: 0, cost_per_piece: 0, location: '', reserved_quantity: 0 };
  const [form, setForm] = useState(emptyForm);

  // Print order state
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printStep, setPrintStep] = useState<1 | 2>(1);
  const [printSaving, setPrintSaving] = useState(false);
  const [printForm, setPrintForm] = useState(emptyPrint());

  // History modal state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<PrintOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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
    setForm({ model_code: item.model_code, product_name: item.product_name, color: item.color, opening_balance: item.opening_balance, cost_per_piece: item.cost_per_piece, location: item.location, reserved_quantity: item.reserved_quantity });
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

  // ---- Print order logic ----
  const openPrintModal = () => {
    setPrintForm(emptyPrint());
    setPrintStep(1);
    setPrintModalOpen(true);
  };

  const sourceItem = useMemo(
    () => items.find(i => i.id === printForm.source_stock_id) ?? null,
    [items, printForm.source_stock_id],
  );

  const goToStep2 = () => {
    if (!printForm.source_stock_id) { toast('error', 'يرجى اختيار الصنف المصدر'); return; }
    if (printForm.qty_to_print <= 0) { toast('error', 'يرجى إدخال كمية صحيحة'); return; }
    if (sourceItem && printForm.qty_to_print > sourceItem.available_quantity) {
      toast('error', `الكمية (${printForm.qty_to_print}) تتجاوز المتاح (${sourceItem.available_quantity})`);
      return;
    }
    // Pre-fill color and product name from source
    setPrintForm(f => ({
      ...f,
      new_color: f.new_color || sourceItem?.color || '',
      new_product_name: f.new_product_name || (sourceItem ? `${sourceItem.product_name} - مطبوع` : ''),
    }));
    setPrintStep(2);
  };

  const handlePrintSave = async () => {
    if (!printForm.new_model_code || !printForm.new_product_name) {
      toast('error', 'يرجى ملء كود وإسم الموديل الجديد');
      return;
    }
    if (printForm.print_cost_per_piece < 0) {
      toast('error', 'تكلفة الطباعة لا يمكن أن تكون سالبة');
      return;
    }
    setPrintSaving(true);
    try {
      await printOrdersApi.create({
        source_stock_id: printForm.source_stock_id,
        quantity: printForm.qty_to_print,
        date: printForm.date,
        new_model_code: printForm.new_model_code,
        new_product_name: printForm.new_product_name,
        new_color: printForm.new_color,
        print_type: printForm.print_type,
        print_cost_per_piece: printForm.print_cost_per_piece,
        notes: printForm.notes,
      });
      toast('success', 'تم تنفيذ أمر الطباعة بنجاح');
      setPrintModalOpen(false);
      await loadData();
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في تنفيذ أمر الطباعة');
    } finally {
      setPrintSaving(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const data = await printOrdersApi.getAll();
      setHistoryItems(data);
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في جلب السجل');
    } finally {
      setHistoryLoading(false);
    }
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

  const finalUnitCost = (sourceItem?.cost_per_piece ?? 0) + printForm.print_cost_per_piece;
  const inventoryValue = printForm.qty_to_print * finalUnitCost;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">📦 مخزن الاستوك الجاهز</h1><p className="text-sm text-gray-500">إدارة المخزون وإنتاج جديد مبيعات آلي</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={openHistory} className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"><History size={16} /> سجل الطباعة</button>
          <button onClick={openPrintModal} className="flex items-center gap-2 px-3 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"><Printer size={16} /> أمر طباعة</button>
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

      {/* Add / Edit modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الصنف' : 'إضافة صنف جديد'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>كود الموديل *</label><input className={ic} value={form.model_code} onChange={e => setForm({...form, model_code: e.target.value})} placeholder="M001" /></div>
          <div><label className={lc}>اسم الصنف *</label><input className={ic} value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} /></div>
          <div><label className={lc}>اللون</label><input className={ic} value={form.color} onChange={e => setForm({...form, color: e.target.value})} /></div>
          <div><label className={lc}>رصيد أول</label><input type="number" className={ic} value={form.opening_balance} onChange={e => setForm({...form, opening_balance: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>تكلفة القطعة</label><input type="number" className={ic} value={form.cost_per_piece} onChange={e => setForm({...form, cost_per_piece: parseFloat(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>المكان</label><input className={ic} value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="مثال: مخزن ميدو" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      {/* Print Order modal */}
      <Modal isOpen={printModalOpen} onClose={() => setPrintModalOpen(false)} title="أمر طباعة" size="lg">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {[{ n: 1, label: 'اختيار الصنف' }, { n: 2, label: 'بيانات الطباعة' }].map(({ n, label }) => (
            <div key={n} className="flex items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${printStep >= n ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{n}</div>
              <span className={`text-xs font-medium ${printStep >= n ? 'text-purple-700' : 'text-gray-400'}`}>{label}</span>
              {n < 2 && <ChevronLeft size={14} className="text-gray-300 mx-1" />}
            </div>
          ))}
        </div>

        {printStep === 1 && (
          <div className="space-y-4">
            <div>
              <label className={lc}>التاريخ</label>
              <input type="date" className={ic} value={printForm.date} onChange={e => setPrintForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className={lc}>الصنف المصدر (سادة) *</label>
              <select
                className={ic}
                value={printForm.source_stock_id}
                onChange={e => setPrintForm(f => ({ ...f, source_stock_id: parseInt(e.target.value) || 0, qty_to_print: 0 }))}
              >
                <option value={0}>اختر صنفاً...</option>
                {items.filter(i => i.available_quantity > 0).map(i => (
                  <option key={i.id} value={i.id}>
                    {i.model_code} — {i.product_name} — {i.color} (متاح: {i.available_quantity})
                  </option>
                ))}
              </select>
            </div>

            {sourceItem && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-purple-50 border border-purple-200 rounded-xl text-sm">
                <div><span className="text-gray-500 text-xs">الصنف</span><p className="font-semibold text-gray-800">{sourceItem.product_name}</p></div>
                <div><span className="text-gray-500 text-xs">اللون</span><p className="font-semibold text-gray-800">{sourceItem.color || '—'}</p></div>
                <div><span className="text-gray-500 text-xs">الكمية المتاحة</span><p className="font-bold text-emerald-700">{sourceItem.available_quantity.toLocaleString('ar-EG')}</p></div>
                <div><span className="text-gray-500 text-xs">تكلفة القطعة (سادة)</span><p className="font-semibold text-purple-700">{fmt(sourceItem.cost_per_piece)}</p></div>
              </div>
            )}

            <div>
              <label className={lc}>الكمية المراد طباعتها *</label>
              <input
                type="number"
                className={`${ic} ${sourceItem && printForm.qty_to_print > sourceItem.available_quantity ? 'border-red-400 focus:ring-red-400' : ''}`}
                value={printForm.qty_to_print}
                onChange={e => setPrintForm(f => ({ ...f, qty_to_print: parseInt(e.target.value) || 0 }))}
                min={0}
                max={sourceItem?.available_quantity ?? undefined}
              />
              {sourceItem && printForm.qty_to_print > sourceItem.available_quantity && (
                <p className="text-xs text-red-600 mt-1">⚠ تتجاوز المتاح ({sourceItem.available_quantity})</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button onClick={() => setPrintModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
              <button onClick={goToStep2} className="flex items-center gap-2 px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                التالي <ChevronLeft size={16} />
              </button>
            </div>
          </div>
        )}

        {printStep === 2 && (
          <div className="space-y-4">
            {/* Summary from step 1 */}
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex flex-wrap gap-4">
              <span>المصدر: <strong>{sourceItem?.product_name} ({sourceItem?.color})</strong></span>
              <span>الكمية: <strong>{printForm.qty_to_print}</strong></span>
              <span>تكلفة السادة: <strong>{fmt(sourceItem?.cost_per_piece ?? 0)}</strong></span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className={lc}>كود الموديل الجديد *</label><input className={ic} value={printForm.new_model_code} onChange={e => setPrintForm(f => ({ ...f, new_model_code: e.target.value }))} placeholder="مثال: M-PRINT-001" /></div>
              <div><label className={lc}>اسم المنتج الجديد *</label><input className={ic} value={printForm.new_product_name} onChange={e => setPrintForm(f => ({ ...f, new_product_name: e.target.value }))} /></div>
              <div><label className={lc}>اللون</label><input className={ic} value={printForm.new_color} onChange={e => setPrintForm(f => ({ ...f, new_color: e.target.value }))} /></div>
              <div><label className={lc}>نوع الطباعة</label><input className={ic} value={printForm.print_type} onChange={e => setPrintForm(f => ({ ...f, print_type: e.target.value }))} placeholder="مثال: سيلك، ديجيتال..." /></div>
              <div>
                <label className={lc}>تكلفة الطباعة للقطعة (ج.م) *</label>
                <input type="number" className={ic} value={printForm.print_cost_per_piece} onChange={e => setPrintForm(f => ({ ...f, print_cost_per_piece: parseFloat(e.target.value) || 0 }))} min={0} step="0.01" />
              </div>
              <div><label className={lc}>ملاحظات</label><input className={ic} value={printForm.notes} onChange={e => setPrintForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>

            {/* Cost summary */}
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-sm">
              <p className="font-bold text-purple-800 mb-2">💰 ملخص التكلفة</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-purple-700">
                <div><p className="text-xs text-purple-500">تكلفة السادة</p><p className="font-semibold">{fmt(sourceItem?.cost_per_piece ?? 0)}</p></div>
                <div><p className="text-xs text-purple-500">تكلفة الطباعة</p><p className="font-semibold">{fmt(printForm.print_cost_per_piece)}</p></div>
                <div><p className="text-xs text-purple-500">تكلفة الوحدة الجديدة</p><p className="font-bold text-purple-900">{fmt(finalUnitCost)}</p></div>
                <div><p className="text-xs text-purple-500">قيمة المخزون الجديد</p><p className="font-bold text-purple-900">{fmt(inventoryValue)}</p></div>
              </div>
            </div>

            <div className="flex justify-between gap-3 pt-4 border-t border-gray-200">
              <button onClick={() => setPrintStep(1)} className="flex items-center gap-2 px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                <ChevronRight size={16} /> السابق
              </button>
              <div className="flex gap-3">
                <button onClick={() => setPrintModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
                <button onClick={handlePrintSave} disabled={printSaving} className="flex items-center gap-2 px-5 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-60">
                  <Printer size={16} />{printSaving ? 'جارٍ الحفظ...' : 'تنفيذ أمر الطباعة'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Print Orders History modal */}
      <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="سجل أوامر الطباعة" size="lg">
        {historyLoading ? (
          <div className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</div>
        ) : historyItems.length === 0 ? (
          <p className="text-center py-8 text-gray-400">لا توجد أوامر طباعة</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-purple-600 text-white">
                  {['رقم الأمر', 'التاريخ', 'المصدر', 'الوجهة', 'الكمية', 'سادة (ج.م)', 'طباعة (ج.م)', 'نهائي (ج.م)', 'بواسطة'].map(h => (
                    <th key={h} className="px-3 py-2 text-center font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historyItems.map(po => (
                  <tr key={po.id} className="border-t border-gray-100 hover:bg-purple-50/40">
                    <td className="px-3 py-2 text-center font-bold text-purple-700">{po.order_number}</td>
                    <td className="px-3 py-2 text-center">{po.date}</td>
                    <td className="px-3 py-2 text-center">
                      <p className="font-medium">{po.source_model_code}</p>
                      <p className="text-gray-500">{po.source_product_name} {po.source_color && `(${po.source_color})`}</p>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <p className="font-medium">{po.dest_model_code}</p>
                      <p className="text-gray-500">{po.dest_product_name} {po.dest_color && `(${po.dest_color})`}</p>
                    </td>
                    <td className="px-3 py-2 text-center font-semibold">{po.quantity}</td>
                    <td className="px-3 py-2 text-center">{po.blank_unit_cost.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-center">{po.print_cost_per_piece.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-center font-bold text-purple-700">{po.final_unit_cost.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-center text-gray-500">{po.created_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end mt-4 pt-4 border-t border-gray-200">
          <button onClick={() => setHistoryOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إغلاق</button>
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

import { useState, useEffect, useMemo } from 'react';
import { readyStockStore } from '../data/store';
import { dashboardApi, printOrdersApi, readyStockApi, type ProductionInfo, type ReservationBreakdown } from '../services/api';
import { matchesSearch, modelCodesOf, rowsForView, type StockView } from '../utils/readyStockViews';
import type { MissingStockSummaryData } from '../types';
import type { ReadyStock, ComputedReadyStock, PrintOrder } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
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
  const { can } = useAuth();
  const [items, setItems] = useState<ComputedReadyStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ReadyStock | null>(null);
  const [search, setSearch] = useState('');
  // Menus above the table (view only — they never change a balance or a reservation)
  const [view, setView] = useState<StockView>('all');
  const [model, setModel] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [shortage, setShortage] = useState<MissingStockSummaryData | null>(null);
  const [shortageError, setShortageError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // ── reserved / production editing (nothing is typed into a balance: reservations come from orders, stock from production entries) ──
  const [resItem, setResItem] = useState<ComputedReadyStock | null>(null);
  const [resData, setResData] = useState<ReservationBreakdown | null>(null);
  const [resBusy, setResBusy] = useState(false);
  const [resConfirm, setResConfirm] = useState(false);
  const [prodItem, setProdItem] = useState<ComputedReadyStock | null>(null);
  const [prodData, setProdData] = useState<ProductionInfo | null>(null);
  const [prodMode, setProdMode] = useState<'new' | 'correct'>('new');
  const [prodStep, setProdStep] = useState<1 | 2>(1);
  const [prodBusy, setProdBusy] = useState(false);
  const [prodKey, setProdKey] = useState('');
  const [prodForm, setProdForm] = useState({ qty: '', cut: '', reason: '', entryId: 0, newQty: '' });
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
    try {
      setItems(await readyStockStore.getComputed({
        includeSales: can('sales.view'),
        includeModelProd: can('model_prod.view'),
        includeReturns: can('returns.view'),
      }));
    }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
    // Order-level detail of the shortages comes from the same summary the Dashboard shows (read-only).
    if (can('dashboard.view')) {
      try { setShortage((await dashboardApi.getMetrics()).missing_stock ?? null); setShortageError(''); }
      catch { setShortage(null); setShortageError('تعذر تحميل تفاصيل الأوردرات للنواقص'); }
    }
  };
  useEffect(() => { loadData(); }, []);

  const openReservation = async (item: ComputedReadyStock) => {
    setResItem(item); setResData(null); setResConfirm(false);
    try { setResData(await readyStockApi.getReservations(item.id)); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'تعذر جلب الحجوزات'); setResItem(null); }
  };
  const reconcileReservation = async () => {
    if (!resItem || resBusy) return;
    setResBusy(true);
    try {
      const r = await readyStockApi.reconcileReservations(resItem.id);
      toast('success', r.changed ? `تمت المطابقة: المحجوز ${r.before.toLocaleString('ar-EG')} ← ${r.after.toLocaleString('ar-EG')}` : 'الحجز مطابق للأوردرات — لا تغيير');
      setResItem(null); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في مطابقة الحجز'); }
    finally { setResBusy(false); }
  };

  const openProduction = async (item: ComputedReadyStock) => {
    setProdItem(item); setProdData(null); setProdMode('new'); setProdStep(1);
    setProdForm({ qty: '', cut: '', reason: '', entryId: 0, newQty: '' }); setProdKey(crypto.randomUUID());
    try { setProdData(await readyStockApi.getProduction(item.id)); } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'تعذر جلب الإنتاج'); setProdItem(null); }
  };
  const prodProblem = (): string => {
    if (prodMode === 'new') {
      const q = Number(prodForm.qty);
      if (!Number.isInteger(q) || q <= 0) return 'كمية الإنتاج يجب أن تكون عددًا صحيحًا أكبر من صفر';
      if (!prodForm.cut) return 'اختر رقم القص';
      return '';
    }
    const entry = prodData?.entries.find(e => e.id === prodForm.entryId);
    if (!entry) return 'اختر إدخال الإنتاج المراد تصحيحه';
    const q = Number(prodForm.newQty);
    if (prodForm.newQty === '' || !Number.isInteger(q) || q < 0) return 'الكمية المستلمة يجب أن تكون عددًا صحيحًا صفرًا أو أكبر';
    if (q > entry.qty_from_cutting) return `المستلم لا يتجاوز الخارج من القص (${entry.qty_from_cutting})`;
    if (q === entry.qty_received) return 'لم تتغير الكمية';
    if (prodForm.reason.trim().length < 3) return 'سبب التصحيح مطلوب';
    return '';
  };
  const submitProduction = async () => {
    if (!prodItem || prodBusy) return;
    const problem = prodProblem();
    if (problem) { toast('error', problem); return; }
    setProdBusy(true);
    try {
      if (prodMode === 'new') {
        const r = await readyStockApi.addProduction(prodItem.id, { qty: Number(prodForm.qty), cut_number: Number(prodForm.cut), reason: prodForm.reason.trim() || undefined, idempotency_key: prodKey });
        toast('success', r.duplicate ? 'هذا الإدخال مسجّل مسبقًا' : 'تم تسجيل الإنتاج');
      } else {
        const r = await readyStockApi.correctProduction(prodItem.id, prodForm.entryId, { qty_received: Number(prodForm.newQty), reason: prodForm.reason.trim() });
        toast('success', r.changed ? 'تم تصحيح الكمية المستلمة' : 'لا تغيير');
      }
      setProdItem(null); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ في حفظ الإنتاج'); setProdStep(1); }
    finally { setProdBusy(false); }
  };

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

  const modelCodes = useMemo(() => modelCodesOf(items), [items]);
  const visibleCodes = useMemo(() => modelCodes.filter(m => !modelSearch || m.code.toLowerCase().includes(modelSearch.trim().toLowerCase())), [modelCodes, modelSearch]);
  // a model menu whose code disappeared (deleted / renamed) falls back to all inventory
  useEffect(() => { if (view === 'model' && !modelCodes.some(m => m.code.toLowerCase() === model.toLowerCase())) { setView('all'); setModel(''); } }, [modelCodes, view, model]);

  const counts = useMemo(() => ({
    all: items.length,
    available: rowsForView(items, 'available').length,
    shortages: shortage ? shortage.rows.length : rowsForView(items, 'shortages').length,
  }), [items, shortage]);

  // Table rows: the selected menu, then the search field on top of it.
  const filtered = useMemo(() => rowsForView(items, view === 'shortages' ? 'all' : view, model).filter(r => matchesSearch(r, search)), [items, view, model, search]);
  // Shortages menu: the existing shortage summary rows (model + colour, with their orders); falls back to stock rows with a pending quantity.
  const shortageRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (shortage?.rows ?? []).filter(r => !q || `${r.model_code} ${r.model_name} ${r.color} ${r.orders.map(o => `${o.order_number} ${o.client}`).join(' ')}`.toLowerCase().includes(q));
  }, [shortage, search]);
  const fallbackShortage = useMemo(() => rowsForView(items, 'shortages').filter(r => matchesSearch(r, search)), [items, search]);

  const exportExcel = () => {
    if (view === 'shortages') {
      const rows = shortage ? shortageRows.map(r => ({ 'كود الموديل': r.model_code, 'اسم الصنف': r.model_name, 'اللون': r.color, 'المطلوب': r.required, 'المحجوز': r.reserved, 'الناقص': r.missing, 'الأوردرات': r.orders.map(o => `${o.order_number} (${o.missing})`).join('، ') }))
        : fallbackShortage.map(r => ({ 'كود الموديل': r.model_code, 'اسم الصنف': r.product_name, 'اللون': r.color, 'الناقص': r.pending_quantity ?? 0 }));
      const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(rows), 'النواقص'); XLSX.writeFile(wb2, 'ready_stock_shortages.xlsx');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(filtered.map(r => ({ 'كود الموديل': r.model_code, 'اسم الصنف': r.product_name, 'اللون': r.color, 'رصيد أول': r.opening_balance, 'إنتاج جديد': r.new_production, 'إجمالي المبيعات': r.total_sales, 'المرتجعات': r.total_returns, 'الرصيد الفعلي': r.actual_balance, 'محجوز': r.reserved_quantity, 'المتاح': r.available_quantity, 'تكلفة القطعة': r.cost_per_piece, 'قيمة المخزون (الفعلي)': Math.max(0, r.actual_balance) * r.cost_per_piece, 'المكان': r.location })));
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

      {/* Inventory menus: view-only filters over the rows below (no balance or reservation is ever changed here) */}
      <div className="space-y-2" aria-label="قوائم المخزون">
        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-gray-200">
          {([
            { key: 'all', label: 'كل المخزون', n: counts.all },
            { key: 'available', label: 'المتاح', n: counts.available },
            { key: 'shortages', label: 'النواقص', n: counts.shortages },
          ] as const).map(t => (
            <button key={t.key} role="tab" aria-selected={view === t.key} type="button" onClick={() => { setView(t.key); setModel(''); }}
              className={`whitespace-nowrap px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${view === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {t.label} <span className={`text-xs rounded-full px-1.5 py-0.5 ${t.key === 'shortages' && t.n > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{t.n.toLocaleString('ar-EG')}</span>
            </button>
          ))}
        </div>
        {modelCodes.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">قائمة لكل كود:</span>
            {modelCodes.length > 12 && (
              <input value={modelSearch} onChange={e => setModelSearch(e.target.value)} placeholder="ابحث عن كود..." className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-32" aria-label="بحث عن كود موديل" />
            )}
            <div role="tablist" aria-label="أكواد الموديلات" className="flex gap-1.5 overflow-x-auto pb-1">
              {visibleCodes.length === 0 && <span className="text-xs text-gray-400">لا يوجد كود مطابق</span>}
              {visibleCodes.map(m => (
                <button key={m.code} role="tab" aria-selected={view === 'model' && model.toLowerCase() === m.code.toLowerCase()} type="button" onClick={() => { setView('model'); setModel(m.code); }}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold border transition ${view === 'model' && model.toLowerCase() === m.code.toLowerCase() ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                  {m.code} <span className="opacity-70">({m.count.toLocaleString('ar-EG')})</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {view === 'shortages' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">النواقص الفعلية فقط: كميات مطلوبة لأوردرات «يتم التجهيز» ولا يغطيها المخزون الحالي. فتح هذه القائمة لا يُنشئ أي سجل.</p>
          {shortageError && <p className="px-4 py-2 text-xs text-amber-700">{shortageError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-[#1e3a5f] text-white">{['كود الموديل', 'اسم الصنف', 'اللون', 'المطلوب', 'محجوز', 'الناقص', 'الأوردرات'].map(h => <th key={h} className="px-3 py-3 text-center font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
                {!loading && shortage && shortageRows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">لا توجد نواقص مطابقة</td></tr>}
                {!loading && shortage && shortageRows.map(r => (
                  <tr key={`${r.model_code}|${r.color}`} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-3 font-medium">{r.model_code}</td>
                    <td className="px-3 py-3">{r.model_name || '—'}{!r.has_card && <span className="block text-[11px] text-amber-700">لا يوجد كارت مخزون</span>}</td>
                    <td className="px-3 py-3 text-center">{r.color || '—'}</td>
                    <td className="px-3 py-3 text-center">{r.required.toLocaleString('ar-EG')}</td>
                    <td className="px-3 py-3 text-center text-orange-700">{r.reserved.toLocaleString('ar-EG')}</td>
                    <td className="px-3 py-3 text-center font-bold text-red-700">{r.missing.toLocaleString('ar-EG')}</td>
                    <td className="px-3 py-3 text-xs text-gray-600">{r.orders.map(o => `${o.order_number} — ${o.client} (ناقص ${o.missing})`).join('، ')}</td>
                  </tr>
                ))}
                {!loading && !shortage && fallbackShortage.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">لا توجد نواقص</td></tr>}
                {!loading && !shortage && fallbackShortage.map(r => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-3 font-medium">{r.model_code}</td><td className="px-3 py-3">{r.product_name}</td><td className="px-3 py-3 text-center">{r.color || '—'}</td>
                    <td className="px-3 py-3 text-center text-gray-300">—</td><td className="px-3 py-3 text-center text-orange-700">{r.reserved_quantity.toLocaleString('ar-EG')}</td>
                    <td className="px-3 py-3 text-center font-bold text-red-700">{(r.pending_quantity ?? 0).toLocaleString('ar-EG')}</td><td className="px-3 py-3 text-xs text-gray-400">غير متاحة لصلاحيتك</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view !== 'shortages' && (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="bg-[#1e3a5f] text-white">
              {['#','كود الموديل','اسم الصنف','اللون','رصيد أول','إنتاج جديد 🔄','إجمالي مبيعات 🔄','المرتجعات 🔄','الرصيد الفعلي 🔄','محجوز 🔒','المتاح ✅','ناقص (مطلوب لأوردرات)','تكلفة القطعة','قيمة المخزون (الفعلي)','المكان','إجراءات'].map(h => <th key={h} className="px-3 py-3 text-center font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={16} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={16} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
              {filtered.map((item, idx) => (
                <tr key={item.id} className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${item.available_quantity < 0 ? 'bg-red-100' : item.available_quantity < 3 ? 'bg-red-50' : item.available_quantity <= 10 ? 'bg-amber-50' : ''}`}>
                  <td className="px-3 py-3 text-center text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-3 font-medium">{item.model_code}</td>
                  <td className="px-3 py-3">{item.product_name}</td>
                  <td className="px-3 py-3 text-center">{item.color}</td>
                  <td className="px-3 py-3 text-center">{item.opening_balance.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center font-semibold text-emerald-600">
                    {item.new_production.toLocaleString('ar-EG')}
                    {can('ready_stock.create') && can('model_prod.create') && <button type="button" onClick={() => openProduction(item)} title="إدخال / تصحيح الإنتاج" aria-label="إدخال أو تصحيح الإنتاج" className="mr-1 p-1 text-emerald-700 hover:bg-emerald-100 rounded"><Edit2 size={13} /></button>}
                  </td>
                  <td className="px-3 py-3 text-center text-red-600">{item.total_sales.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center text-emerald-600 font-semibold">{item.total_returns.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center font-bold text-gray-700">{item.actual_balance.toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-3 text-center">
                    {item.reserved_quantity > 0
                      ? <span className="inline-block bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5 rounded-full">{item.reserved_quantity.toLocaleString('ar-EG')}</span>
                      : <span className="text-gray-300">—</span>}
                    {can('ready_stock.edit') && <button type="button" onClick={() => openReservation(item)} title="عرض / مطابقة الحجز" aria-label="عرض أو مطابقة الحجز" className="mr-1 p-1 text-orange-700 hover:bg-orange-100 rounded"><Edit2 size={13} /></button>}
                  </td>
                  <td className={`px-3 py-3 text-center font-bold ${item.available_quantity < 0 ? 'text-red-700 font-extrabold' : item.available_quantity < 3 ? 'text-red-600' : item.available_quantity <= 10 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {item.available_quantity.toLocaleString('ar-EG')}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {(item.pending_quantity ?? 0) > 0
                      ? <span className="inline-block bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">{(item.pending_quantity ?? 0).toLocaleString('ar-EG')}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-center">{item.cost_per_piece.toLocaleString('ar-EG')}</td>
                  {/* Physical (available + reserved) × recorded cost — reserved goods are still owned. */}
                  <td className="px-3 py-3 text-center font-semibold text-blue-700">{(Math.max(0, item.actual_balance) * item.cost_per_piece).toLocaleString('ar-EG')}</td>
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
      )}

      {/* Reserved quantity: derived from orders — shown, explained and reconciled, never typed over */}
      <Modal isOpen={!!resItem} onClose={() => setResItem(null)} title={resItem ? `الحجز — ${resItem.model_code} ${resItem.color || ''}` : 'الحجز'} size="lg">
        {!resData ? <p className="text-center py-6 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">الرصيد الفعلي</p><p className="font-bold">{resData.actual.toLocaleString('ar-EG')}</p></div>
              <div className="bg-orange-50 rounded-lg p-3"><p className="text-xs text-orange-700">المحجوز الحالي</p><p className="font-bold text-orange-800">{resData.reserved.toLocaleString('ar-EG')}</p></div>
              <div className="bg-emerald-50 rounded-lg p-3"><p className="text-xs text-emerald-700">المتاح (الفعلي − المحجوز)</p><p className="font-bold text-emerald-800">{resData.available.toLocaleString('ar-EG')}</p></div>
              <div className="bg-red-50 rounded-lg p-3"><p className="text-xs text-red-700">الناقص لأوردرات</p><p className="font-bold text-red-800">{resData.pending.toLocaleString('ar-EG')}</p></div>
            </div>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">الحجز مشتق من أوردرات «يتم التجهيز» (الأقدم أولًا) ولا يُكتب يدويًا حتى لا يتعارض مع حجوزات الأوردرات الأخرى. لتغيير الحجز عدّل كمية الأوردر أو حالته. هنا يمكنك مطابقة الرقم المخزَّن مع الأوردرات.</p>
            {resData.orders.length === 0 ? <p className="text-center text-sm text-gray-400">لا توجد أوردرات تحجز هذا الصنف</p> : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg"><table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr>{['الأوردر', 'العميل', 'المطلوب', 'محجوز', 'ناقص'].map(h => <th key={h} className="px-3 py-2 text-right font-semibold">{h}</th>)}</tr></thead>
                <tbody>{resData.orders.map(o => <tr key={o.sale_id} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{o.order_number}</td><td className="px-3 py-2 text-gray-600">{o.client}</td><td className="px-3 py-2">{o.requested.toLocaleString('ar-EG')}</td><td className="px-3 py-2 text-orange-700">{o.reserved.toLocaleString('ar-EG')}</td><td className="px-3 py-2 text-red-700">{o.pending.toLocaleString('ar-EG')}</td></tr>)}</tbody>
              </table></div>
            )}
            {resData.stored_reserved !== resData.reserved && <p className="text-xs text-red-700">الرقم المخزَّن ({resData.stored_reserved.toLocaleString('ar-EG')}) يختلف عن المحسوب من الأوردرات ({resData.reserved.toLocaleString('ar-EG')}) — المطابقة ستصحّحه.</p>}
            <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
              <button onClick={() => setResItem(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إغلاق</button>
              {!resConfirm
                ? <button onClick={() => setResConfirm(true)} className="px-5 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700">مطابقة الحجز مع الأوردرات</button>
                : <button onClick={reconcileReservation} disabled={resBusy} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60">{resBusy ? 'جارٍ المطابقة...' : 'تأكيد المطابقة'}</button>}
            </div>
          </div>
        )}
      </Modal>

      {/* Production: a new production entry, or a correction of an earlier one — never a typed-over stock balance */}
      <Modal isOpen={!!prodItem} onClose={() => !prodBusy && setProdItem(null)} title={prodItem ? `الإنتاج — ${prodItem.model_code} ${prodItem.color || ''}` : 'الإنتاج'} size="lg">
        {!prodData ? <p className="text-center py-6 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</p> : (
          <div className="space-y-4">
            <div className="flex gap-2">
              {([['new', 'إدخال إنتاج جديد'], ['correct', 'تصحيح إدخال سابق']] as const).map(([k, label]) => (
                <button key={k} type="button" disabled={prodBusy} onClick={() => { setProdMode(k); setProdStep(1); }} className={`px-4 py-1.5 text-sm rounded-lg border ${prodMode === k ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]' : 'bg-white text-gray-600 border-gray-300'}`}>{label}</button>
              ))}
            </div>
            {prodStep === 1 && prodMode === 'new' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className={lc}>الكمية المنتَجة *</label><input type="number" min={1} className={ic} value={prodForm.qty} onChange={e => setProdForm({ ...prodForm, qty: e.target.value })} /></div>
                <div><label className={lc}>رقم القص *</label>
                  <select className={ic} value={prodForm.cut} onChange={e => setProdForm({ ...prodForm, cut: e.target.value })}>
                    <option value="">اختر...</option>
                    {[...new Map(prodData.cuts.map(c => [c.cut_number, c])).values()].map(c => <option key={c.cut_number} value={c.cut_number}>قصة {c.cut_number} — {c.description || c.color} ({c.total_pieces.toLocaleString('ar-EG')} قطعة)</option>)}
                  </select>
                  {prodData.cuts.length === 0 && <p className="text-xs text-amber-700 mt-1">لا يوجد أمر قص بهذا اللون — سجّل القص أولًا.</p>}
                </div>
                <div className="md:col-span-2"><label className={lc}>ملاحظة (اختياري)</label><input className={ic} value={prodForm.reason} onChange={e => setProdForm({ ...prodForm, reason: e.target.value })} /></div>
                <p className="md:col-span-2 text-xs text-gray-500">يُسجَّل كإدخال إنتاج جديد (مستلم بالكامل) يخصم من القطع المتبقية في القصة، ويزيد الرصيد الفعلي مرة واحدة، ثم يُعاد توزيع الحجوزات تلقائيًا.</p>
              </div>
            )}
            {prodStep === 1 && prodMode === 'correct' && (
              <div className="space-y-3">
                {prodData.entries.length === 0 ? <p className="text-center text-sm text-gray-400">لا توجد إدخالات إنتاج لهذا الصنف</p> : (
                  <div className="overflow-x-auto border border-gray-100 rounded-lg"><table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600"><tr>{['', 'التاريخ', 'القصة', 'الحالة', 'خرج من القص', 'المستلم', 'الهالك'].map(h => <th key={h} className="px-3 py-2 text-right font-semibold">{h}</th>)}</tr></thead>
                    <tbody>{prodData.entries.map(e => (
                      <tr key={e.id} className={`border-t border-gray-100 cursor-pointer ${prodForm.entryId === e.id ? 'bg-blue-50' : ''}`} onClick={() => setProdForm({ ...prodForm, entryId: e.id, newQty: String(e.qty_received) })}>
                        <td className="px-3 py-2"><input type="radio" readOnly checked={prodForm.entryId === e.id} aria-label={`اختيار إدخال ${e.id}`} /></td>
                        <td className="px-3 py-2">{e.date}</td><td className="px-3 py-2">{e.cut_number}</td><td className="px-3 py-2">{e.status}</td>
                        <td className="px-3 py-2">{e.qty_from_cutting.toLocaleString('ar-EG')}</td><td className="px-3 py-2 font-bold text-emerald-700">{e.qty_received.toLocaleString('ar-EG')}</td><td className="px-3 py-2">{e.wastage.toLocaleString('ar-EG')}</td>
                      </tr>))}</tbody>
                  </table></div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><label className={lc}>الكمية المستلمة الصحيحة *</label><input type="number" min={0} className={ic} value={prodForm.newQty} onChange={e => setProdForm({ ...prodForm, newQty: e.target.value })} /></div>
                  <div><label className={lc}>سبب التصحيح *</label><input className={ic} value={prodForm.reason} onChange={e => setProdForm({ ...prodForm, reason: e.target.value })} /></div>
                </div>
                <p className="text-xs text-gray-500">التصحيح يعدّل الكمية المستلمة في سجل الإنتاج نفسه (لا يُنشئ إدخالًا جديدًا ولا يكتب فوق الرصيد) ويُسجَّل في سجل التعديلات بالقيمة القديمة والجديدة. لا يُسمح به إن جعل الرصيد الفعلي سالبًا.</p>
              </div>
            )}
            {prodStep === 2 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm space-y-1">
                <p className="font-semibold text-amber-900">تأكيد الحفظ</p>
                {prodMode === 'new'
                  ? <p>إدخال إنتاج جديد: <strong>{Number(prodForm.qty).toLocaleString('ar-EG')}</strong> قطعة من {prodItem?.model_code} ({prodItem?.color || '—'}) من القصة {prodForm.cut}.</p>
                  : <p>تصحيح المستلم من <strong>{prodData.entries.find(e => e.id === prodForm.entryId)?.qty_received.toLocaleString('ar-EG')}</strong> إلى <strong>{Number(prodForm.newQty).toLocaleString('ar-EG')}</strong> — {prodForm.reason}</p>}
                <p className="text-xs text-amber-800">سيُعاد حساب المتاح والنواقص والحجوزات تلقائيًا.</p>
              </div>
            )}
            <div className="flex justify-between gap-3 pt-3 border-t border-gray-200">
              <button onClick={() => (prodStep === 2 ? setProdStep(1) : setProdItem(null))} disabled={prodBusy} className="px-5 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-60">{prodStep === 2 ? 'رجوع' : 'إلغاء'}</button>
              {prodStep === 1
                ? <button onClick={() => { const p = prodProblem(); if (p) toast('error', p); else setProdStep(2); }} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]">متابعة</button>
                : <button onClick={submitProduction} disabled={prodBusy} className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60">{prodBusy ? 'جارٍ الحفظ...' : 'تأكيد وحفظ'}</button>}
            </div>
          </div>
        )}
      </Modal>

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

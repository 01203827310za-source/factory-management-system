import { useState, useEffect, useMemo } from 'react';
import { fabricStore } from '../data/store';
import { fabricPurchasesApi, type FabricPurchaseRecord } from '../services/api';
import type { FabricWarehouse, ComputedFabric } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw, ShoppingCart, ChevronDown, ChevronUp } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useCrudPermissions } from '../hooks/usePermissions';
import { findBestMatch, textsMatch } from '../utils/textMatch';

const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

const emptyPurchaseForm = {
  date: '', fabric_type: '', color: '', quantity_kg: 0,
  price_per_kg: 0, supplier: '', invoice_no: '', notes: '',
};

export default function FabricWarehouse() {
  const toast = useToast();
  const fabricPerms = useCrudPermissions('fabric');
  const purchasePerms = useCrudPermissions('fabric_purchases');
  const [items, setItems] = useState<ComputedFabric[]>([]);
  const [purchases, setPurchases] = useState<FabricPurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<FabricWarehouse | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showPurchaseLog, setShowPurchaseLog] = useState(true);
  const [editPurchaseItem, setEditPurchaseItem] = useState<FabricPurchaseRecord | null>(null);
  const [deletePurchaseConfirm, setDeletePurchaseConfirm] = useState<number | null>(null);
  const emptyForm: Omit<FabricWarehouse, 'id' | 'created_at'> = {
    date: '',
    material_type: '',
    color: '',
    qty_in: 0,
    cost_per_kg: 0,
    avg_cost_per_kg: 0,
    last_purchase_price: 0,
  };
  const [form, setForm] = useState(emptyForm);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);

  const loadData = async () => {
    setLoading(true);
    try {
      const [fabricData, purchaseData] = await Promise.all([
        fabricStore.getComputed(),
        fabricPurchasesApi.getAll(),
      ]);
      setItems(fabricData);
      setPurchases(purchaseData);
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);

  // Unique fabric types from warehouse for autocomplete
  const fabricTypes = useMemo(() => [...new Set(items.map(i => i.material_type))].sort(), [items]);

  // Current warehouse info for the selected purchase type+color (for reference display)
  const purchaseMatchRow = useMemo(() => {
    if (!purchaseForm.fabric_type) return null;
    const sameType = items.filter(i => textsMatch(i.material_type, purchaseForm.fabric_type, 'color'));
    return findBestMatch(sameType, purchaseForm.color || '', i => i.color, 'color') || null;
  }, [items, purchaseForm.fabric_type, purchaseForm.color]);

  // Preview weighted average for the purchase form
  const previewAvg = useMemo(() => {
    const qty = purchaseForm.quantity_kg;
    const price = purchaseForm.price_per_kg;
    if (!purchaseMatchRow || qty <= 0 || price <= 0) return null;
    const currentQty = purchaseMatchRow.qty_in;
    const currentAvg = purchaseMatchRow.avg_cost_per_kg > 0
      ? purchaseMatchRow.avg_cost_per_kg
      : purchaseMatchRow.cost_per_kg;
    const totalQty = currentQty + qty;
    return totalQty > 0
      ? Math.round(((currentQty * currentAvg + qty * price) / totalQty) * 100) / 100
      : price;
  }, [purchaseMatchRow, purchaseForm.quantity_kg, purchaseForm.price_per_kg]);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: FabricWarehouse) => {
    setEditItem(item);
    setForm({
      date: item.date,
      material_type: item.material_type,
      color: item.color,
      qty_in: item.qty_in,
      cost_per_kg: item.cost_per_kg,
      avg_cost_per_kg: item.avg_cost_per_kg,
      last_purchase_price: item.last_purchase_price,
    });
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

  const openEditPurchase = (p: FabricPurchaseRecord) => {
    setEditPurchaseItem(p);
    setPurchaseForm({
      date: p.date, fabric_type: p.fabric_type, color: p.color,
      quantity_kg: p.quantity_kg, price_per_kg: p.price_per_kg,
      supplier: p.supplier, invoice_no: p.invoice_no, notes: p.notes,
    });
    setPurchaseModalOpen(true);
  };

  const handleSavePurchase = async () => {
    if (!purchaseForm.fabric_type) { toast('error', 'يرجى تحديد الصنف'); return; }
    if (purchaseForm.quantity_kg <= 0) { toast('error', 'الكمية يجب أن تكون أكبر من صفر'); return; }
    if (purchaseForm.price_per_kg <= 0) { toast('error', 'السعر يجب أن يكون أكبر من صفر'); return; }
    if (!purchaseForm.date) { toast('error', 'يرجى تحديد التاريخ'); return; }
    setSaving(true);
    try {
      if (editPurchaseItem) {
        await fabricPurchasesApi.update(editPurchaseItem.id, purchaseForm);
        toast('success', 'تم تعديل المشتريات وتحديث المخزون');
      } else {
        await fabricPurchasesApi.add(purchaseForm);
        toast('success', 'تم حفظ المشتريات وتحديث المخزون');
      }
      setPurchaseModalOpen(false);
      setEditPurchaseItem(null);
      setPurchaseForm(emptyPurchaseForm);
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDeletePurchase = async (id: number) => {
    try {
      await fabricPurchasesApi.remove(id);
      toast('success', 'تم حذف المشتريات وتحديث المخزون');
      setDeletePurchaseConfirm(null);
      await loadData();
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ');
      setDeletePurchaseConfirm(null);
    }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(r => r.material_type.toLowerCase().includes(q) || r.color.toLowerCase().includes(q));
  }, [items, search]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items.map(r => ({
      'التاريخ': r.date, 'الصنف': r.material_type, 'اللون': r.color,
      'كمية واردة': r.qty_in, 'مستهلكة': r.qty_consumed, 'الرصيد': r.available_balance,
      'متوسط التكلفة/كجم': r.avg_cost_per_kg || r.cost_per_kg,
      'آخر سعر شراء': r.last_purchase_price || r.cost_per_kg,
    }))), 'المخزون');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchases.map(p => ({
      'التاريخ': p.date, 'الصنف': p.fabric_type, 'اللون': p.color,
      'الكمية (كجم)': p.quantity_kg, 'سعر الكيلو': p.price_per_kg,
      'الإجمالي': p.total_cost, 'المورد': p.supplier, 'رقم الفاتورة': p.invoice_no,
    }))), 'المشتريات');
    XLSX.writeFile(wb, 'fabric_export.xlsx');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🧵 مخزن القماش</h1>
          <p className="text-sm text-gray-500">إدارة مواد القماش والخامات</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
            <Download size={16} /> تصدير
          </button>
          {purchasePerms.canCreate && <button
            onClick={() => { setPurchaseForm(emptyPurchaseForm); setPurchaseModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700"
          >
            <ShoppingCart size={16} /> إضافة مشتريات
          </button>}
          {fabricPerms.canCreate && <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]">
            <Plus size={16} /> إضافة وارد
          </button>}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالنوع، اللون..." className={`w-full pr-10 ${ic}`} />
      </div>

      {/* Warehouse table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                {['#','التاريخ','الصنف','اللون','كمية واردة (كجم)','مستهلكة 🔄','الرصيد 🔄','متوسط التكلفة','آخر سعر شراء','إجراءات']
                  .map(h => <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>
              )}
              {filtered.map((item, idx) => {
                const avgCost = item.avg_cost_per_kg > 0 ? item.avg_cost_per_kg : item.cost_per_kg;
                const lastPrice = item.last_purchase_price > 0 ? item.last_purchase_price : item.cost_per_kg;
                return (
                  <tr key={item.id} className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${item.available_balance < 5 ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-center">{item.date}</td>
                    <td className="px-4 py-3 font-medium">{item.material_type}</td>
                    <td className="px-4 py-3 text-center">{item.color}</td>
                    <td className="px-4 py-3 text-center text-emerald-600">{fmt(item.qty_in)}</td>
                    <td className="px-4 py-3 text-center text-red-600">{fmt(item.qty_consumed)}</td>
                    <td className={`px-4 py-3 text-center font-bold ${item.available_balance < 5 ? 'text-red-700' : 'text-gray-800'}`}>
                      {fmt(item.available_balance)}
                    </td>
                    <td className="px-4 py-3 text-center text-blue-700 font-semibold">{fmt(avgCost)}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{fmt(lastPrice)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {fabricPerms.canEdit && <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>}
                        {fabricPerms.canDelete && <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Purchase log section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowPurchaseLog(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 bg-orange-50 hover:bg-orange-100 transition"
        >
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-orange-600" />
            <span className="font-bold text-orange-800">سجل مشتريات القماش</span>
            <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">{purchases.length} عملية</span>
          </div>
          {showPurchaseLog ? <ChevronUp size={18} className="text-orange-600" /> : <ChevronDown size={18} className="text-orange-600" />}
        </button>

        {showPurchaseLog && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="bg-orange-600 text-white">
                  {['#','التاريخ','الصنف','اللون','الكمية (كجم)','سعر الكيلو','الإجمالي','المورد','رقم الفاتورة','ملاحظات','إجراءات']
                    .map(h => <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {purchases.length === 0 && (
                  <tr><td colSpan={11} className="text-center py-6 text-gray-400">لا توجد مشتريات مسجلة</td></tr>
                )}
                {purchases.map((p, idx) => (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-orange-50/30 transition">
                    <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-center">{p.date}</td>
                    <td className="px-4 py-3 font-medium">{p.fabric_type}</td>
                    <td className="px-4 py-3 text-center">{p.color || '—'}</td>
                    <td className="px-4 py-3 text-center text-emerald-700 font-semibold">{fmt(p.quantity_kg)}</td>
                    <td className="px-4 py-3 text-center">{fmt(p.price_per_kg)}</td>
                    <td className="px-4 py-3 text-center font-bold text-blue-700">{fmt(p.total_cost)}</td>
                    <td className="px-4 py-3 text-center">{p.supplier || '—'}</td>
                    <td className="px-4 py-3 text-center text-xs">{p.invoice_no || '—'}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">{p.notes || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {purchasePerms.canEdit && <button onClick={() => openEditPurchase(p)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg" title="تعديل"><Edit2 size={15} /></button>}
                        {purchasePerms.canDelete && <button onClick={() => setDeletePurchaseConfirm(p.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg" title="حذف"><Trash2 size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {purchases.length > 0 && (
                  <tr className="bg-orange-50 border-t-2 border-orange-200 font-bold">
                    <td colSpan={4} className="px-4 py-3 text-right text-orange-800">الإجمالي</td>
                    <td className="px-4 py-3 text-center text-emerald-700">{fmt(purchases.reduce((s, p) => s + p.quantity_kg, 0))}</td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3 text-center text-blue-700">{fmt(purchases.reduce((s, p) => s + p.total_cost, 0))}</td>
                    <td colSpan={4}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit warehouse entry modal (existing behavior unchanged) */}
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

      {/* Purchase modal (add / edit) */}
      <Modal isOpen={purchaseModalOpen} onClose={() => { setPurchaseModalOpen(false); setEditPurchaseItem(null); setPurchaseForm(emptyPurchaseForm); }} title={editPurchaseItem ? 'تعديل مشتريات قماش' : 'إضافة مشتريات قماش'} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={lc}>التاريخ *</label>
            <input type="date" className={ic} value={purchaseForm.date} onChange={e => setPurchaseForm({...purchaseForm, date: e.target.value})} />
          </div>
          <div>
            <label className={lc}>الصنف *</label>
            <input
              className={ic} list="fabric-types-list"
              value={purchaseForm.fabric_type}
              onChange={e => setPurchaseForm({...purchaseForm, fabric_type: e.target.value})}
              placeholder="اكتب أو اختر من القائمة"
            />
            <datalist id="fabric-types-list">
              {fabricTypes.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
          <div>
            <label className={lc}>اللون</label>
            <input className={ic} value={purchaseForm.color} onChange={e => setPurchaseForm({...purchaseForm, color: e.target.value})} />
          </div>
          <div>
            <label className={lc}>الكمية (كجم) *</label>
            <input type="number" className={ic} value={purchaseForm.quantity_kg || ''} onChange={e => setPurchaseForm({...purchaseForm, quantity_kg: parseFloat(e.target.value)||0})} min={0} step="0.1" />
          </div>
          <div>
            <label className={lc}>سعر الكيلو *</label>
            <input type="number" className={ic} value={purchaseForm.price_per_kg || ''} onChange={e => setPurchaseForm({...purchaseForm, price_per_kg: parseFloat(e.target.value)||0})} min={0} step="0.01" />
          </div>
          <div>
            <label className={lc}>إجمالي التكلفة (محسوب تلقائياً)</label>
            <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 font-bold text-blue-700">
              {fmt((purchaseForm.quantity_kg || 0) * (purchaseForm.price_per_kg || 0))} جنيه
            </div>
          </div>
          <div>
            <label className={lc}>المورد (اختياري)</label>
            <input className={ic} value={purchaseForm.supplier} onChange={e => setPurchaseForm({...purchaseForm, supplier: e.target.value})} />
          </div>
          <div>
            <label className={lc}>رقم الفاتورة (اختياري)</label>
            <input className={ic} value={purchaseForm.invoice_no} onChange={e => setPurchaseForm({...purchaseForm, invoice_no: e.target.value})} />
          </div>
          <div className="md:col-span-2">
            <label className={lc}>ملاحظات (اختياري)</label>
            <input className={ic} value={purchaseForm.notes} onChange={e => setPurchaseForm({...purchaseForm, notes: e.target.value})} />
          </div>
        </div>

        {/* Live preview: only shown in add mode */}
        {!editPurchaseItem && purchaseMatchRow && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm space-y-1">
            <p className="font-bold text-blue-800 mb-1">📦 المخزون الحالي — {purchaseForm.fabric_type} / {purchaseForm.color || '—'}</p>
            <div className="grid grid-cols-2 gap-x-6 text-blue-700">
              <span>الكمية الحالية: <strong>{fmt(purchaseMatchRow.qty_in)} كجم</strong></span>
              <span>متوسط التكلفة: <strong>{fmt(purchaseMatchRow.avg_cost_per_kg > 0 ? purchaseMatchRow.avg_cost_per_kg : purchaseMatchRow.cost_per_kg)} جنيه/كجم</strong></span>
              {previewAvg !== null && purchaseForm.quantity_kg > 0 && purchaseForm.price_per_kg > 0 && (
                <>
                  <span>الكمية بعد الشراء: <strong>{fmt(purchaseMatchRow.qty_in + purchaseForm.quantity_kg)} كجم</strong></span>
                  <span className="text-emerald-700">متوسط التكلفة الجديد: <strong>{fmt(previewAvg)} جنيه/كجم</strong></span>
                </>
              )}
            </div>
          </div>
        )}
        {!editPurchaseItem && !purchaseMatchRow && purchaseForm.fabric_type && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            ⚠️ لا يوجد صنف مطابق في المخزون — سيتم إنشاء سجل جديد تلقائياً
          </div>
        )}
        {editPurchaseItem && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800">
            ℹ️ سيتم إعادة حساب متوسط التكلفة وكمية المخزون تلقائياً بعد الحفظ
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => { setPurchaseModalOpen(false); setEditPurchaseItem(null); setPurchaseForm(emptyPurchaseForm); }} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={handleSavePurchase} disabled={saving} className="px-5 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : editPurchaseItem ? 'حفظ التعديلات' : 'حفظ المشتريات'}
          </button>
        </div>
      </Modal>

      {/* Delete confirm modal — warehouse entry */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button>
        </div>
      </Modal>

      {/* Delete confirm modal — purchase record */}
      <Modal isOpen={deletePurchaseConfirm !== null} onClose={() => setDeletePurchaseConfirm(null)} title="تأكيد حذف المشترى" size="sm">
        <p className="text-gray-600 mb-1">هل أنت متأكد من حذف هذه العملية؟</p>
        <p className="text-sm text-orange-700">سيتم عكس الكمية وإعادة حساب متوسط التكلفة تلقائياً.</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeletePurchaseConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={() => deletePurchaseConfirm !== null && handleDeletePurchase(deletePurchaseConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button>
        </div>
      </Modal>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { modelProdStore, cuttingStore, readyStockStore } from '../data/store';
import type { ModelProduction, ModelPart } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

const STATUSES: ModelProduction['status'][] = ['قيد التشغيل', 'تام', 'هالك'];
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' ج.م';

type PartEntry = { part_type: string; cut_number: number; color: string };

const emptyPart = (): PartEntry => ({ part_type: '', cut_number: 0, color: '' });

const emptyForm = () => ({
  date: '',
  parts: [emptyPart()],
  model_code: '',
  qty_from_cutting: 0,
  model_description: '',
  color: '',
  sizes: '',
  status: 'تام' as ModelProduction['status'],
  wastage: 0,
  qty_received: 0,
  cost_per_piece: 0,
  warehouse_entry_date: '',
});

// Display helper: "قميص→101(أسود) / شورت→205(أسود)" or just "101" fallback
function partsLabel(item: ModelProduction): string {
  if (item.parts && item.parts.length > 0) {
    return item.parts
      .map((p: ModelPart) => {
        const base = p.part_type ? `${p.part_type}→${p.cut_number}` : String(p.cut_number);
        return p.color ? `${base}(${p.color})` : base;
      })
      .join(' / ');
  }
  return item.cut_number ? String(item.cut_number) : '-';
}

export default function ModelProductionPage() {
  const toast = useToast();
  const [items, setItems] = useState<ModelProduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ModelProduction | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const [cutNumbers, setCutNumbers] = useState<number[]>([]);
  const [cutColors, setCutColors] = useState<Record<number, string[]>>({});
  const [cutColorLoading, setCutColorLoading] = useState<Record<number, boolean>>({});
  const [stockCodes, setStockCodes] = useState<string[]>([]);

  const [form, setForm] = useState(emptyForm());

  const loadData = async () => {
    setLoading(true);
    try {
      const [prods, cuts, stock] = await Promise.all([
        modelProdStore.getAll(),
        cuttingStore.getAll(),
        readyStockStore.getAll(),
      ]);
      setItems(prods);
      setCutNumbers([...new Set(cuts.map(c => c.cut_number))].sort((a, b) => a - b));

      const colorMap: Record<number, string[]> = {};
      cuts.forEach(c => {
        if (!colorMap[c.cut_number]) colorMap[c.cut_number] = [];
        if (c.color && !colorMap[c.cut_number].includes(c.color))
          colorMap[c.cut_number].push(c.color);
      });
      setCutColors(colorMap);

      setStockCodes([...new Set(stock.map(s => s.model_code))]);
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const loadColorsForCut = async (cutNumber: number): Promise<string[]> => {
    if (!cutNumber) return [];
    setCutColorLoading(prev => ({ ...prev, [cutNumber]: true }));
    try {
      const colors = await cuttingStore.getColors(cutNumber);
      setCutColors(prev => ({ ...prev, [cutNumber]: colors }));
      return colors;
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ');
      setCutColors(prev => ({ ...prev, [cutNumber]: [] }));
      return [];
    } finally {
      setCutColorLoading(prev => ({ ...prev, [cutNumber]: false }));
    }
  };

  const productionColorFromParts = (parts: PartEntry[]) => parts[0]?.color || '';

  useEffect(() => {
    setForm(prev => {
      let changed = false;
      const parts = prev.parts.map(part => {
        const colors = cutColors[part.cut_number] || [];
        if (part.cut_number && !part.color && colors.length === 1) {
          changed = true;
          return { ...part, color: colors[0] };
        }
        return part;
      });
      return changed ? { ...prev, parts, color: productionColorFromParts(parts) } : prev;
    });
  }, [cutColors]);

  const openAdd = () => {
    setEditItem(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (item: ModelProduction) => {
    const parts = (item.parts && item.parts.length > 0)
      ? item.parts.map(p => ({ part_type: p.part_type, cut_number: p.cut_number, color: p.color || '' }))
      : [{ part_type: '', cut_number: item.cut_number, color: item.color || '' }];
    setEditItem(item);
    setForm({
      date: item.date,
      parts,
      model_code: item.model_code,
      qty_from_cutting: item.qty_from_cutting,
      model_description: item.model_description,
      color: productionColorFromParts(parts) || item.color,
      sizes: item.sizes,
      status: item.status,
      wastage: item.wastage,
      qty_received: item.qty_received,
      cost_per_piece: item.cost_per_piece ?? 0,
      warehouse_entry_date: item.warehouse_entry_date,
    });
    setModalOpen(true);
    [...new Set(parts.map(p => p.cut_number).filter(Boolean))].forEach(cutNumber => {
      void loadColorsForCut(cutNumber);
    });
  };

  const updatePart = (idx: number, field: keyof PartEntry, value: string | number) => {
    setForm(prev => {
      const parts = prev.parts.map((p, i) => i === idx ? { ...p, [field]: value } : p);
      return { ...prev, parts, color: productionColorFromParts(parts) };
    });
  };

  const updatePartCut = async (idx: number, newCut: number) => {
    setForm(prev => {
      const parts = prev.parts.map((p, i) => i === idx ? { ...p, cut_number: newCut, color: '' } : p);
      return { ...prev, parts, color: productionColorFromParts(parts) };
    });
    const colors = await loadColorsForCut(newCut);
    if (colors.length === 1) {
      setForm(prev => {
        if (prev.parts[idx]?.cut_number !== newCut) return prev;
        const parts = prev.parts.map((p, i) => i === idx ? { ...p, color: colors[0] } : p);
        return { ...prev, parts, color: productionColorFromParts(parts) };
      });
    }
  };

  const addPart = () => {
    if (form.parts.length >= 3) return;
    setForm({ ...form, parts: [...form.parts, emptyPart()] });
  };

  const removePart = (idx: number) => {
    const parts = form.parts.filter((_, i) => i !== idx);
    setForm({ ...form, parts, color: productionColorFromParts(parts) });
  };

  const handleSave = async () => {
    if (!form.model_code) { toast('error', 'يرجى تحديد كود الموديل'); return; }
    if (form.parts.length === 0) { toast('error', 'يرجى إضافة قصة واحدة على الأقل'); return; }
    const badPart = form.parts.findIndex(p => !p.cut_number || !p.color);
    if (badPart >= 0) {
      toast('error', `يرجى تحديد رقم القصة واللون للجزء ${badPart + 1}`);
      return;
    }
    const noColorPart = form.parts.findIndex(p => (cutColors[p.cut_number] || []).length === 0);
    if (noColorPart >= 0) {
      toast('error', 'لا توجد ألوان متاحة لهذا رقم القص');
      return;
    }
    const invalidColorPart = form.parts.findIndex(p => !(cutColors[p.cut_number] || []).includes(p.color));
    if (invalidColorPart >= 0) {
      toast('error', `لا يمكن اختيار لون غير تابع لرقم القص في الجزء ${invalidColorPart + 1}`);
      return;
    }
    const selectedColor = productionColorFromParts(form.parts);
    const mixedColorPart = form.parts.findIndex(p => p.color !== selectedColor);
    if (mixedColorPart >= 0) {
      toast('error', 'يجب أن تكون كل الأجزاء بنفس اللون');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, color: selectedColor };
      if (editItem) {
        await modelProdStore.update(editItem.id, payload as Partial<ModelProduction>);
        toast('success', 'تم التعديل');
      } else {
        await modelProdStore.add(payload as Omit<ModelProduction, 'id' | 'created_at'>);
        toast('success', 'تم الإضافة');
      }
      setModalOpen(false);
      await loadData();
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await modelProdStore.remove(id);
      toast('success', 'تم الحذف');
      setDeleteConfirm(null);
      await loadData();
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ');
    }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(r =>
      r.model_code.toLowerCase().includes(q) ||
      r.model_description.toLowerCase().includes(q) ||
      String(r.cut_number).includes(q) ||
      (r.parts || []).some(p =>
        String(p.cut_number).includes(q) ||
        p.part_type.toLowerCase().includes(q) ||
        (p.color || '').toLowerCase().includes(q)
      )
    );
  }, [items, search]);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(r => ({
      'التاريخ': r.date,
      'القصص': partsLabel(r),
      'كود الموديل': r.model_code,
      'عدد من القص': r.qty_from_cutting,
      'الوصف': r.model_description,
      'اللون': r.color,
      'المقاسات': r.sizes,
      'الحالة': r.status,
      'الهالك': r.wastage,
      'المستلم': r.qty_received,
      'تكلفة القطعة (ج.م)': r.cost_per_piece ?? 0,
      'قيمة التشغيل (ج.م)': r.status === 'قيد التشغيل' ? r.qty_received * (r.cost_per_piece ?? 0) : 0,
      'تاريخ المخزن': r.warehouse_entry_date,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الموديلات');
    XLSX.writeFile(wb, 'models_export.xlsx');
  };

  const headers = ['#', 'التاريخ', 'القصص', 'كود الموديل', 'من القص', 'الوصف', 'اللون', 'المقاسات', 'الحالة', 'الهالك', 'المستلم', 'تكلفة القطعة', 'قيمة التشغيل', 'المخزن', 'إجراءات'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">👕 رقم الموديل</h1>
          <p className="text-sm text-gray-500">إدارة إنتاج الموديلات</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
            <Download size={16} /> تصدير
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]">
            <Plus size={16} /> إضافة موديل
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالكود، الوصف، رقم القصة، اللون..."
          className={`w-full pr-10 ${ic}`}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                {headers.map(h => <th key={h} className="px-3 py-3 text-center font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={15} className="text-center py-8 text-gray-400">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={15} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>
              )}
              {filtered.map((item, idx) => {
                const isWip = item.status === 'قيد التشغيل';
                const wipValue = isWip ? item.qty_received * (item.cost_per_piece ?? 0) : 0;
                return (
                  <tr key={item.id} className="border-t border-gray-100 hover:bg-blue-50/40 transition">
                    <td className="px-3 py-3 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-3 text-center">{item.date}</td>
                    <td className="px-3 py-3 text-center font-bold text-blue-700 text-xs">{partsLabel(item)}</td>
                    <td className="px-3 py-3 font-medium">{item.model_code}</td>
                    <td className="px-3 py-3 text-center">{item.qty_from_cutting}</td>
                    <td className="px-3 py-3">{item.model_description}</td>
                    <td className="px-3 py-3 text-center">{item.color}</td>
                    <td className="px-3 py-3 text-center text-xs">{item.sizes}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        item.status === 'تام' ? 'bg-emerald-100 text-emerald-700' :
                        item.status === 'قيد التشغيل' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>{item.status}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-red-600">{item.wastage}</td>
                    <td className="px-3 py-3 text-center font-semibold text-emerald-600">{item.qty_received}</td>
                    <td className="px-3 py-3 text-center text-blue-700 font-semibold">
                      {(item.cost_per_piece ?? 0) > 0 ? fmt(item.cost_per_piece) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center font-semibold text-amber-700">
                      {isWip && (item.cost_per_piece ?? 0) > 0 ? fmt(wipValue) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center text-xs">{item.warehouse_entry_date || '-'}</td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                        <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الموديل' : 'إضافة موديل'} size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Date */}
          <div>
            <label className={lc}>التاريخ</label>
            <input type="date" className={ic} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>

          {/* Model code */}
          <div>
            <label className={lc}>كود الموديل *</label>
            <select className={ic} value={form.model_code} onChange={e => setForm({ ...form, model_code: e.target.value })}>
              <option value="">اختر</option>
              {stockCodes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Parts section — full width */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <label className={lc}>القصص (الأجزاء)</label>
              {form.parts.length < 3 && (
                <button
                  type="button"
                  onClick={addPart}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  <Plus size={13} /> إضافة جزء
                </button>
              )}
            </div>
            <div className="space-y-2">
              {form.parts.map((part, idx) => {
                const colors = cutColors[part.cut_number] || [];
                const colorsLoading = !!cutColorLoading[part.cut_number];
                return (
                <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
                  <span className="text-xs text-gray-400 min-w-[40px] text-center">جزء {idx + 1}</span>

                  <input
                    className={`${ic} flex-1`}
                    value={part.part_type}
                    onChange={e => updatePart(idx, 'part_type', e.target.value)}
                    placeholder="نوع (قميص، شورت...)"
                  />

                  <select
                    className={`${ic} flex-1`}
                    value={part.cut_number}
                    onChange={e => { void updatePartCut(idx, parseInt(e.target.value) || 0); }}
                  >
                    <option value={0}>رقم القصة *</option>
                    {cutNumbers.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>

                  <select
                    className={`${ic} flex-1 ${!part.color && part.cut_number ? 'border-red-400' : ''}`}
                    value={part.color}
                    onChange={e => updatePart(idx, 'color', e.target.value)}
                    disabled={!part.cut_number || colorsLoading || colors.length <= 1}
                  >
                    <option value="">{colorsLoading ? 'جارٍ تحميل الألوان...' : 'اللون *'}</option>
                    {colors.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {form.parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePart(idx)}
                      className="p-1 text-red-500 hover:bg-red-50 rounded flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {part.cut_number > 0 && !colorsLoading && colors.length === 0 && (
                  <p className="text-xs text-red-600 px-2">لا توجد ألوان متاحة لهذا رقم القص</p>
                )}
                </div>
              );
              })}
            </div>
          </div>

          {/* Qty from cutting */}
          <div>
            <label className={lc}>العدد من القص</label>
            <input type="number" className={ic} value={form.qty_from_cutting}
              onChange={e => setForm({ ...form, qty_from_cutting: parseInt(e.target.value) || 0 })} min={0} />
          </div>

          {/* Description */}
          <div>
            <label className={lc}>وصف الموديل</label>
            <input className={ic} value={form.model_description}
              onChange={e => setForm({ ...form, model_description: e.target.value })} />
          </div>

          {/* Color */}
          <div>
            <label className={lc}>اللون</label>
            <select className={ic} value={form.color} disabled>
              <option value="">اختر اللون من رقم القص</option>
              {form.color && <option value={form.color}>{form.color}</option>}
            </select>
          </div>

          {/* Sizes */}
          <div>
            <label className={lc}>المقاسات</label>
            <input className={ic} value={form.sizes}
              onChange={e => setForm({ ...form, sizes: e.target.value })} placeholder="S,M,L,XL" />
          </div>

          {/* Status */}
          <div>
            <label className={lc}>الحالة</label>
            <select className={ic} value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value as ModelProduction['status'] })}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Wastage */}
          <div>
            <label className={lc}>الهالك</label>
            <input type="number" className={ic} value={form.wastage}
              onChange={e => setForm({ ...form, wastage: parseInt(e.target.value) || 0 })} min={0} />
          </div>

          {/* Qty received */}
          <div>
            <label className={lc}>العدد المستلم (تام)</label>
            <input type="number" className={ic} value={form.qty_received}
              onChange={e => setForm({ ...form, qty_received: parseInt(e.target.value) || 0 })} min={0} />
          </div>

          {/* Cost per piece */}
          <div>
            <label className={lc}>تكلفة القطعة (ج.م)</label>
            <input type="number" className={ic} value={form.cost_per_piece}
              onChange={e => setForm({ ...form, cost_per_piece: parseFloat(e.target.value) || 0 })} min={0} step="0.01" />
          </div>

          {/* Warehouse entry date */}
          <div>
            <label className={lc}>تاريخ دخول المخزن</label>
            <input type="date" className={ic} value={form.warehouse_entry_date}
              onChange={e => setForm({ ...form, warehouse_entry_date: e.target.value })} />
          </div>

        </div>

        {/* WIP value preview */}
        {form.status === 'قيد التشغيل' && form.cost_per_piece > 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
            <p className="font-bold text-amber-800 mb-1">🏭 قيمة التشغيل المقدرة</p>
            <div className="grid grid-cols-3 gap-3 text-amber-700">
              <span>تكلفة القطعة: <strong>{fmt(form.cost_per_piece)}</strong></span>
              <span>المستلم: <strong>{form.qty_received}</strong></span>
              <span>القيمة الإجمالية: <strong className="text-amber-900">{fmt(form.qty_received * form.cost_per_piece)}</strong></span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>

      {/* Delete confirmation */}
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

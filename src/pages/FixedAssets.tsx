import { useState, useEffect, useMemo } from 'react';
import { fixedAssetsApi, type FixedAssetRecord } from '../services/api';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw, Landmark } from 'lucide-react';
import * as XLSX from 'xlsx';

const ic = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const lc = 'block text-xs font-semibold text-gray-600 mb-1';

const CATEGORIES = ['ماكينات', 'معدات', 'أثاث', 'كمبيوتر', 'سيارات', 'أجهزة', 'أخرى'];

type ComputedAsset = FixedAssetRecord & {
  depreciation_rate: number;
  annual_depreciation: number;
  accumulated_depreciation: number;
  current_book_value: number;
};

function computeDepreciation(a: FixedAssetRecord): ComputedAsset {
  const life = Math.max(1, a.useful_life_years);
  const depRate = 100 / life;
  const annualDep = a.purchase_price / life;
  const purchaseDate = new Date(a.purchase_date);
  const yearsSince = isNaN(purchaseDate.getTime())
    ? 0
    : (Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const accumulatedDep = Math.min(annualDep * yearsSince, a.purchase_price);
  const bookValue = Math.max(0, a.purchase_price - accumulatedDep);
  return {
    ...a,
    depreciation_rate: depRate,
    annual_depreciation: annualDep,
    accumulated_depreciation: accumulatedDep,
    current_book_value: bookValue,
  };
}

const emptyForm = {
  name: '',
  category: 'ماكينات',
  purchase_date: '',
  purchase_price: 0,
  useful_life_years: 5,
  notes: '',
};

export default function FixedAssets() {
  const toast = useToast();
  const [items, setItems] = useState<ComputedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<FixedAssetRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);

  const loadData = async () => {
    setLoading(true);
    try {
      const raw = await fixedAssetsApi.getAll();
      setItems(raw.map(computeDepreciation));
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في جلب البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openAdd = () => {
    setEditItem(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (item: FixedAssetRecord) => {
    setEditItem(item);
    setForm({
      name: item.name,
      category: item.category,
      purchase_date: item.purchase_date,
      purchase_price: item.purchase_price,
      useful_life_years: item.useful_life_years,
      notes: item.notes,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast('error', 'اسم الأصل مطلوب'); return; }
    if (!form.purchase_date) { toast('error', 'تاريخ الشراء مطلوب'); return; }
    if (form.useful_life_years < 1) { toast('error', 'العمر الإنتاجي يجب أن يكون سنة على الأقل'); return; }
    setSaving(true);
    try {
      if (editItem) {
        await fixedAssetsApi.update(editItem.id, form);
        toast('success', 'تم التعديل بنجاح');
      } else {
        await fixedAssetsApi.add(form);
        toast('success', 'تمت الإضافة بنجاح');
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
      await fixedAssetsApi.remove(id);
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
      r.name.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.notes.toLowerCase().includes(q)
    );
  }, [items, search]);

  const totalCost = items.reduce((s, a) => s + a.purchase_price, 0);
  const totalBookValue = items.reduce((s, a) => s + a.current_book_value, 0);
  const totalCount = items.length;

  const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  const fmtDec = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 1 });

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(r => ({
      'اسم الأصل': r.name,
      'الفئة': r.category,
      'تاريخ الشراء': r.purchase_date,
      'سعر الشراء': r.purchase_price,
      'العمر الإنتاجي (سنة)': r.useful_life_years,
      'معدل الاستهلاك %': fmtDec(r.depreciation_rate),
      'الاستهلاك السنوي': fmt(r.annual_depreciation),
      'مجمع الاستهلاك': fmt(r.accumulated_depreciation),
      'القيمة الدفترية الحالية': fmt(r.current_book_value),
      'ملاحظات': r.notes,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأصول الثابتة');
    XLSX.writeFile(wb, 'fixed_assets_export.xlsx');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Landmark size={24} className="text-[#1e3a5f]" /> الأصول الثابتة
          </h1>
          <p className="text-sm text-gray-500">إدارة الأصول وحساب الاستهلاك</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
            <Download size={16} /> تصدير
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]">
            <Plus size={16} /> إضافة أصل
          </button>
        </div>
      </div>

      {/* Dashboard Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-blue-200 p-4 shadow-sm">
          <p className="text-xs font-semibold text-blue-600 mb-1">إجمالي تكلفة الأصول</p>
          <p className="text-2xl font-bold text-blue-800">{fmt(totalCost)}</p>
          <p className="text-xs text-gray-400 mt-1">جنيه</p>
        </div>
        <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-sm">
          <p className="text-xs font-semibold text-emerald-600 mb-1">القيمة الدفترية الحالية</p>
          <p className="text-2xl font-bold text-emerald-800">{fmt(totalBookValue)}</p>
          <p className="text-xs text-gray-400 mt-1">جنيه</p>
        </div>
        <div className="bg-white rounded-xl border border-purple-200 p-4 shadow-sm">
          <p className="text-xs font-semibold text-purple-600 mb-1">عدد الأصول</p>
          <p className="text-2xl font-bold text-purple-800">{totalCount}</p>
          <p className="text-xs text-gray-400 mt-1">أصل</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو الفئة..."
          className={`w-full pr-10 ${ic}`}
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                {['#', 'اسم الأصل', 'الفئة', 'تاريخ الشراء', 'سعر الشراء', 'العمر الإنتاجي', 'معدل الاستهلاك %', 'الاستهلاك السنوي', 'مجمع الاستهلاك', 'القيمة الدفترية', 'ملاحظات', 'إجراءات'].map(h => (
                  <th key={h} className="px-3 py-3 text-center font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-gray-400">
                    <RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-gray-400">لا توجد بيانات</td>
                </tr>
              )}
              {filtered.map((item, idx) => {
                const fullyDepreciated = item.current_book_value === 0;
                return (
                  <tr key={item.id} className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${fullyDepreciated ? 'bg-gray-50' : ''}`}>
                    <td className="px-3 py-3 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-3 py-3 font-medium text-gray-800">{item.name}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">{item.category}</span>
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600">{item.purchase_date}</td>
                    <td className="px-3 py-3 text-center font-semibold text-gray-800">{fmt(item.purchase_price)}</td>
                    <td className="px-3 py-3 text-center text-gray-600">{item.useful_life_years} سنة</td>
                    <td className="px-3 py-3 text-center text-orange-600 font-semibold">{fmtDec(item.depreciation_rate)}%</td>
                    <td className="px-3 py-3 text-center text-red-600">{fmt(item.annual_depreciation)}</td>
                    <td className="px-3 py-3 text-center text-red-700 font-semibold">{fmt(item.accumulated_depreciation)}</td>
                    <td className={`px-3 py-3 text-center font-bold ${fullyDepreciated ? 'text-gray-400' : 'text-emerald-700'}`}>
                      {fmt(item.current_book_value)}
                    </td>
                    <td className="px-3 py-3 text-center text-gray-500 max-w-[120px] truncate">{item.notes || '—'}</td>
                    <td className="px-3 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg">
                          <Edit2 size={15} />
                        </button>
                        <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg">
                          <Trash2 size={15} />
                        </button>
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
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الأصل' : 'إضافة أصل جديد'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className={lc}>اسم الأصل *</label>
            <input className={ic} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="مثال: ماكينة خياطة رقم 1" />
          </div>
          <div>
            <label className={lc}>الفئة</label>
            <select className={ic} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={lc}>تاريخ الشراء *</label>
            <input type="date" className={ic} value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} />
          </div>
          <div>
            <label className={lc}>سعر الشراء (جنيه)</label>
            <input type="number" className={ic} value={form.purchase_price} onChange={e => setForm({ ...form, purchase_price: parseFloat(e.target.value) || 0 })} min={0} />
          </div>
          <div>
            <label className={lc}>العمر الإنتاجي (سنوات)</label>
            <input type="number" className={ic} value={form.useful_life_years} onChange={e => setForm({ ...form, useful_life_years: parseInt(e.target.value) || 1 })} min={1} />
          </div>
          {form.purchase_price > 0 && form.useful_life_years >= 1 && (
            <div className="md:col-span-2 bg-blue-50 rounded-lg p-3 text-sm text-blue-800 grid grid-cols-2 gap-2">
              <div><span className="font-semibold">معدل الاستهلاك:</span> {fmtDec(100 / form.useful_life_years)}% سنوياً</div>
              <div><span className="font-semibold">الاستهلاك السنوي:</span> {fmt(form.purchase_price / form.useful_life_years)} جنيه</div>
            </div>
          )}
          <div className="md:col-span-2">
            <label className={lc}>ملاحظات</label>
            <textarea className={ic} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] disabled:opacity-60">
            {saving ? 'جارٍ الحفظ...' : 'حفظ'}
          </button>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذا الأصل؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">حذف</button>
        </div>
      </Modal>
    </div>
  );
}

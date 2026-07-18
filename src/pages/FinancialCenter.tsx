import { useState, useEffect } from 'react';
import { fixedAssetsApi, financialCenterApi } from '../services/api';
import type { FixedAssetRecord, FinancialCenterData } from '../services/api';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import StatCard from '../components/StatCard';
import { Plus, Edit2, Trash2, RefreshCw, TrendingUp, Landmark, Layers, Scale } from 'lucide-react';

const ic = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const lc = 'block text-xs font-semibold text-gray-600 mb-1';
const fmt = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyForm: Omit<FixedAssetRecord, 'id' | 'created_at'> = {
  name: '',
  category: '',
  purchase_date: '',
  purchase_price: 0,
  useful_life_years: 1,
  notes: '',
};

export default function FinancialCenter() {
  const toast = useToast();
  const [assets, setAssets] = useState<FixedAssetRecord[]>([]);
  const [metrics, setMetrics] = useState<FinancialCenterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<FixedAssetRecord | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, m] = await Promise.all([fixedAssetsApi.getAll(), financialCenterApi.getData()]);
      setAssets(a);
      setMetrics(m);
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
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
    if (!form.name) { toast('error', 'يرجى كتابة اسم الأصل'); return; }
    if (!form.purchase_date) { toast('error', 'يرجى تحديد التاريخ'); return; }
    setSaving(true);
    try {
      if (editItem) {
        await fixedAssetsApi.update(editItem.id, form);
        toast('success', 'تم تعديل الأصل بنجاح');
      } else {
        await fixedAssetsApi.add(form);
        toast('success', 'تم إضافة الأصل بنجاح');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🏦 المركز المالي</h1>
          <p className="text-sm text-gray-500">ملخص الأصول والمركز المالي للمصنع</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm animate-pulse h-28" />
          ))}
        </div>
      ) : metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="إجمالي الأصول المتداولة"
            value={`${fmt(metrics.total_current_assets)} ج`}
            icon={<TrendingUp size={22} />}
            color="blue"
          />
          <StatCard
            title="إجمالي الأصول الثابتة"
            value={`${fmt(metrics.total_fixed_assets)} ج`}
            icon={<Landmark size={22} />}
            color="purple"
          />
          <StatCard
            title="إجمالي الأصول"
            value={`${fmt(metrics.total_assets)} ج`}
            icon={<Layers size={22} />}
            color="green"
          />
          <StatCard
            title="صافي المركز المالي"
            value={`${fmt(metrics.net_position)} ج`}
            icon={<Scale size={22} />}
            color={metrics.net_position >= 0 ? 'green' : 'red'}
          />
        </div>
      )}

      {/* Current Assets Breakdown */}
      {metrics && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-700 mb-4 pb-2 border-b border-gray-100">📊 تفاصيل الأصول المتداولة</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { label: 'مخزن القماش', value: metrics.fabric_value },
              { label: 'مخزن الاستوك', value: metrics.stock_value },
              { label: 'مخزن الإكسسوارات', value: metrics.accessories_value },
              { label: 'حسابات العملاء', value: metrics.money_owed_to_us },
              { label: 'السيولة الحالية', value: metrics.cash_available },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <span className="text-sm text-gray-600">{label}</span>
                <span className={`text-sm font-bold ${value >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
                  {fmt(value)} ج
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3 border border-blue-100">
              <span className="text-sm font-semibold text-blue-800">الإجمالي</span>
              <span className="text-sm font-bold text-blue-800">{fmt(metrics.total_current_assets)} ج</span>
            </div>
          </div>
        </div>
      )}

      {/* Fixed Assets Table */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-700">🏗️ الأصول الثابتة</h2>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-xl hover:bg-[#16304d] transition"
          >
            <Plus size={16} /> إضافة أصل
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">جارٍ التحميل...</div>
        ) : assets.length === 0 ? (
          <div className="text-center py-8 text-gray-400">لا توجد أصول ثابتة مسجلة</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="text-right px-3 py-2.5 rounded-r-lg font-semibold">#</th>
                  <th className="text-right px-3 py-2.5 font-semibold">اسم الأصل</th>
                  <th className="text-right px-3 py-2.5 font-semibold">التاريخ</th>
                  <th className="text-right px-3 py-2.5 font-semibold">القيمة (ج)</th>
                  <th className="text-right px-3 py-2.5 font-semibold">ملاحظات</th>
                  <th className="text-right px-3 py-2.5 rounded-l-lg font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assets.map((item, idx) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition">
                    <td className="px-3 py-2.5 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{item.name}</td>
                    <td className="px-3 py-2.5 text-gray-600">{item.purchase_date}</td>
                    <td className="px-3 py-2.5 font-bold text-purple-700">{fmt(item.purchase_price)}</td>
                    <td className="px-3 py-2.5 text-gray-500">{item.notes || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-purple-50">
                  <td colSpan={3} className="px-3 py-2.5 font-bold text-purple-800 text-right">الإجمالي</td>
                  <td className="px-3 py-2.5 font-bold text-purple-800">
                    {fmt(assets.reduce((s, a) => s + a.purchase_price, 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل أصل ثابت' : 'إضافة أصل ثابت'}>
        <div className="space-y-4 p-1">
          <div>
            <label className={lc}>اسم الأصل *</label>
            <input className={ic} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="مثال: سيارة نقل، ماكينة خياطة..." />
          </div>
          <div>
            <label className={lc}>التاريخ *</label>
            <input type="date" className={ic} value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} />
          </div>
          <div>
            <label className={lc}>القيمة (ج)</label>
            <input type="number" min={0} className={ic} value={form.purchase_price} onChange={e => setForm({ ...form, purchase_price: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <label className={lc}>ملاحظات</label>
            <textarea className={ic} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60">
              {saving ? 'جارٍ الحفظ...' : editItem ? 'تعديل' : 'إضافة'}
            </button>
            <button onClick={() => setModalOpen(false)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف">
        <div className="p-1 space-y-4">
          <p className="text-gray-600 text-sm">هل أنت متأكد من حذف هذا الأصل؟ لا يمكن التراجع.</p>
          <div className="flex gap-3">
            <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 transition">
              حذف
            </button>
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

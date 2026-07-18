import { useState, useEffect } from 'react';
import { usersApi, partnersApi, type User, type CreateUserInput, type PartnerRecord } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { Plus, Edit2, Trash2, ShieldCheck, Eye, Settings, UserCheck, UserX, Users } from 'lucide-react';
import { usePartners } from '../contexts/PartnerContext';

const ROLE_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  admin:   { label: 'مدير النظام', color: 'bg-purple-100 text-purple-800', icon: <ShieldCheck size={14} /> },
  manager: { label: 'مشرف',        color: 'bg-blue-100 text-blue-800',     icon: <Settings size={14} /> },
  viewer:  { label: 'مشاهد',        color: 'bg-gray-100 text-gray-700',     icon: <Eye size={14} /> },
};

const emptyForm: CreateUserInput = { username: '', password: '', full_name: '', role: 'viewer' };

export default function UsersPage() {
  const toast = useToast();
  const { user: currentUser, isAdmin } = useAuth();
  const { partners, reload: reloadPartners } = usePartners();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState<CreateUserInput & { password?: string }>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Partner management state
  const [deactivateTarget, setDeactivateTarget] = useState<PartnerRecord | null>(null);
  const [partnerBusy, setPartnerBusy] = useState(false);

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setPartnerBusy(true);
    try {
      await partnersApi.deactivate(deactivateTarget.id);
      toast('success', `تم إلغاء تفعيل ${deactivateTarget.name}`);
      setDeactivateTarget(null);
      await reloadPartners();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ');
    } finally {
      setPartnerBusy(false);
    }
  };

  const handleReactivate = async (p: PartnerRecord) => {
    setPartnerBusy(true);
    try {
      await partnersApi.reactivate(p.id);
      toast('success', `تم إعادة تفعيل ${p.name}`);
      await reloadPartners();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ');
    } finally {
      setPartnerBusy(false);
    }
  };

  const load = async () => {
    try {
      setUsers(await usersApi.getAll());
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ في جلب المستخدمين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditUser(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({ username: u.username, password: '', full_name: u.full_name, role: u.role });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast('error', 'الاسم مطلوب'); return; }
    if (!editUser && !form.password) { toast('error', 'كلمة المرور مطلوبة للمستخدم الجديد'); return; }
    if (!editUser && !form.username.trim()) { toast('error', 'اسم المستخدم مطلوب'); return; }

    setSaving(true);
    try {
      if (editUser) {
        const updateData: Partial<CreateUserInput> = { full_name: form.full_name, role: form.role };
        if (form.password) updateData.password = form.password;
        await usersApi.update(editUser.id, updateData);
        toast('success', 'تم تحديث المستخدم');
      } else {
        await usersApi.create(form as CreateUserInput);
        toast('success', 'تم إضافة المستخدم');
      }
      setModalOpen(false);
      load();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: User) => {
    try {
      await usersApi.update(u.id, { is_active: !u.is_active });
      toast('success', u.is_active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
      load();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await usersApi.remove(id);
      toast('success', 'تم حذف المستخدم');
      setDeleteConfirm(null);
      load();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ في الحذف');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">جارٍ التحميل...</div>;

  return (
    <div dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">إدارة المستخدمين</h1>
          <p className="text-gray-500 text-sm mt-1">{users.length} مستخدم مسجل</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-[#1e3a5f] text-white px-4 py-2.5 rounded-xl hover:bg-[#16304d] transition"
        >
          <Plus size={18} /> إضافة مستخدم
        </button>
      </div>

      {/* Role Permissions Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Object.entries(ROLE_LABELS).map(([role, info]) => (
          <div key={role} className="bg-white rounded-xl p-4 border border-gray-100">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${info.color} mb-2`}>
              {info.icon} {info.label}
            </div>
            <p className="text-xs text-gray-500">
              {role === 'admin' && 'كل الصلاحيات + إدارة المستخدمين'}
              {role === 'manager' && 'إضافة وتعديل وحذف جميع البيانات'}
              {role === 'viewer' && 'عرض البيانات فقط بدون تعديل'}
            </p>
          </div>
        ))}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['الاسم', 'اسم المستخدم', 'الدور', 'الحالة', 'آخر دخول', 'إجراءات'].map(h => (
                <th key={h} className="px-4 py-3 text-right font-semibold text-gray-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const role = ROLE_LABELS[u.role];
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${!u.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {u.full_name}
                    {isSelf && <span className="mr-2 text-xs text-blue-500">(أنت)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${role.color}`}>
                      {role.icon} {role.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {u.is_active ? <><UserCheck size={12} /> نشط</> : <><UserX size={12} /> معطل</>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {u.last_login ? new Date(u.last_login).toLocaleDateString('ar-EG') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(u)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="تعديل">
                        <Edit2 size={15} />
                      </button>
                      {!isSelf && (
                        <>
                          <button onClick={() => toggleActive(u)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition" title={u.is_active ? 'تعطيل' : 'تفعيل'}>
                            {u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                          </button>
                          <button onClick={() => setDeleteConfirm(u.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition" title="حذف">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Partner Management */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mt-6">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users size={20} className="text-blue-600" />
          <h2 className="text-lg font-bold text-gray-800">إدارة الشركاء</h2>
        </div>
        <div className="p-4 space-y-3">
          {partners.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">لا توجد بيانات شركاء — تأكد من تطبيق migration قاعدة البيانات</p>
          )}
          {partners.map(p => (
            <div key={p.id} className="flex items-center justify-between p-4 rounded-xl border border-gray-100 bg-gray-50">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${p.is_active ? 'bg-[#1e3a5f]' : 'bg-gray-400'}`}>
                  {p.name[0]}
                </div>
                <div>
                  <p className="font-semibold text-gray-800">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {p.is_active ? 'نشط' : `خارج منذ ${p.exit_date || '—'}`}
                    </span>
                    <span className={`text-xs font-semibold ${p.net_balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      الرصيد: {p.net_balance.toLocaleString('ar-EG')} ج
                    </span>
                  </div>
                </div>
              </div>
              {isAdmin && (
                <div>
                  {p.is_active ? (
                    <button
                      onClick={() => setDeactivateTarget(p)}
                      disabled={partnerBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition disabled:opacity-50"
                    >
                      <UserX size={14} /> إلغاء التفعيل
                    </button>
                  ) : (
                    <button
                      onClick={() => handleReactivate(p)}
                      disabled={partnerBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-600 border border-green-200 rounded-lg hover:bg-green-50 transition disabled:opacity-50"
                    >
                      <UserCheck size={14} /> إعادة التفعيل
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Deactivate Partner Confirmation Modal */}
      <Modal isOpen={deactivateTarget !== null} onClose={() => setDeactivateTarget(null)} title="إلغاء تفعيل الشريك">
        {deactivateTarget && (
          <div className="space-y-4 p-1">
            <div className={`rounded-xl p-4 ${Math.abs(deactivateTarget.net_balance) > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
              <p className="font-semibold text-gray-800 mb-1">الشريك: {deactivateTarget.name}</p>
              <p className={`text-sm font-bold ${deactivateTarget.net_balance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                الرصيد الحالي: {deactivateTarget.net_balance.toLocaleString('ar-EG')} جنيه
              </p>
              {Math.abs(deactivateTarget.net_balance) > 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  تحذير: هذا الشريك لديه رصيد غير صفري. يُنصح بتسجيل تسوية نهائية في صفحة المصاريف قبل المتابعة.
                </p>
              )}
            </div>
            <p className="text-sm text-gray-600">
              بعد إلغاء التفعيل سيُخفى <strong>{deactivateTarget.name}</strong> من جميع النماذج الجديدة، ولن يظهر في لوحة التحكم. جميع البيانات التاريخية ستُحفظ.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleDeactivate}
                disabled={partnerBusy}
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl hover:bg-red-600 transition disabled:opacity-60 text-sm"
              >
                {partnerBusy ? 'جارٍ...' : 'تأكيد إلغاء التفعيل'}
              </button>
              <button onClick={() => setDeactivateTarget(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition text-sm text-gray-600">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}>
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل</label>
            <input
              value={form.full_name}
              onChange={e => setForm({ ...form, full_name: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              placeholder="مثال: حاتم محمد"
            />
          </div>
          {!editUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم المستخدم</label>
              <input
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] font-mono"
                placeholder="بدون مسافات"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editUser ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)' : 'كلمة المرور'}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              placeholder="6 أحرف على الأقل"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">الصلاحية</label>
            <select
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value as CreateUserInput['role'] })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            >
              <option value="viewer">مشاهد - قراءة فقط</option>
              <option value="manager">مشرف - تعديل وإضافة</option>
              <option value="admin">مدير النظام - كل الصلاحيات</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60"
            >
              {saving ? 'جارٍ الحفظ...' : editUser ? 'تحديث' : 'إضافة'}
            </button>
            <button onClick={() => setModalOpen(false)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition text-gray-600">
              إلغاء
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف">
        <p className="text-gray-600 mb-5">هل أنت متأكد من حذف هذا المستخدم؟</p>
        <div className="flex gap-3">
          <button onClick={() => handleDelete(deleteConfirm!)} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl hover:bg-red-600 transition">حذف</button>
          <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
        </div>
      </Modal>
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  usersApi,
  type User,
  type CreateUserInput,
  type RbacMetadata,
  type RbacPermission,
} from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { Plus, Edit2, Trash2, ShieldCheck, UserCheck, UserX } from 'lucide-react';

type UserForm = {
  username: string;
  password: string;
  full_name: string;
  role: string;
  permissions: string[];
};

const ACTION_LABELS: Record<RbacPermission['action'], string> = {
  view: 'عرض',
  create: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
};

const ACTION_ORDER: RbacPermission['action'][] = ['view', 'create', 'edit', 'delete'];

const emptyForm: UserForm = {
  username: '',
  password: '',
  full_name: '',
  role: 'viewer',
  permissions: [],
};

export default function UsersPage() {
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [rbac, setRbac] = useState<RbacMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const rolePermissions = (roleName: string) =>
    rbac?.roles.find(role => role.name === roleName)?.permissions ?? [];

  const load = async () => {
    setLoading(true);
    try {
      const [usersData, rbacData] = await Promise.all([usersApi.getAll(), usersApi.getRbac()]);
      setUsers(usersData);
      setRbac(rbacData);
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ في جلب المستخدمين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    const defaultPermissions = rolePermissions('viewer');
    setEditUser(null);
    setForm({ ...emptyForm, permissions: defaultPermissions });
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({
      username: u.username,
      password: '',
      full_name: u.full_name,
      role: u.role,
      permissions: u.permissions,
    });
    setModalOpen(true);
  };

  const changeRole = (role: string) => {
    setForm(prev => ({ ...prev, role, permissions: rolePermissions(role) }));
  };

  const togglePermission = (permission: string) => {
    setForm(prev => {
      const next = new Set(prev.permissions);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return { ...prev, permissions: [...next].sort() };
    });
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast('error', 'الاسم مطلوب'); return; }
    if (!editUser && !form.password) { toast('error', 'كلمة المرور مطلوبة للمستخدم الجديد'); return; }
    if (!editUser && !form.username.trim()) { toast('error', 'اسم المستخدم مطلوب'); return; }

    setSaving(true);
    try {
      if (editUser) {
        const updateData: Partial<CreateUserInput> = {
          full_name: form.full_name,
          role: form.role,
          permissions: form.permissions,
        };
        if (form.password) updateData.password = form.password;
        await usersApi.update(editUser.id, updateData);
        toast('success', 'تم تحديث المستخدم');
      } else {
        await usersApi.create({
          username: form.username,
          password: form.password,
          full_name: form.full_name,
          role: form.role,
          permissions: form.permissions,
        });
        toast('success', 'تم إضافة المستخدم');
      }
      setModalOpen(false);
      await load();
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
      await load();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await usersApi.remove(id);
      toast('success', 'تم حذف المستخدم');
      setDeleteConfirm(null);
      await load();
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ في الحذف');
    }
  };

  const permissionKey = (module: string, action: RbacPermission['action']) => `${module}.${action}`;
  const hasPermission = (permission: string) => form.permissions.includes(permission);
  const moduleActions = (moduleKey: string) =>
    rbac?.permissions.filter(permission => permission.module === moduleKey).map(permission => permission.action) ?? [];

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">جارٍ التحميل...</div>;

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-center justify-between">
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
              const role = rbac?.roles.find(item => item.name === u.role);
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${!u.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {u.full_name}
                    {isSelf && <span className="mr-2 text-xs text-blue-500">(أنت)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      <ShieldCheck size={12} /> {role?.display_name ?? u.role}
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

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'} size="lg">
        <div className="space-y-5 p-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الاسم الكامل</label>
              <input
                value={form.full_name}
                onChange={e => setForm({ ...form, full_name: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>
            {!editUser && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اسم المستخدم</label>
                <input
                  value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] font-mono"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editUser ? 'كلمة مرور جديدة' : 'كلمة المرور'}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
                placeholder={editUser ? 'اتركها فارغة للإبقاء على الحالية' : '6 أحرف على الأقل'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الدور</label>
              <select
                value={form.role}
                onChange={e => changeRole(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              >
                {rbac?.roles.map(role => (
                  <option key={role.id} value={role.name}>{role.display_name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <h2 className="text-base font-bold text-gray-800 mb-3">صلاحيات المستخدم</h2>
            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-right font-semibold text-gray-600">الصفحة</th>
                    {ACTION_ORDER.map(action => (
                      <th key={action} className="px-3 py-3 text-center font-semibold text-gray-600">{ACTION_LABELS[action]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rbac?.modules.map(module => {
                    const availableActions = moduleActions(module.key);
                    return (
                      <tr key={module.key}>
                        <td className="px-3 py-2.5 font-medium text-gray-700">{module.label}</td>
                        {ACTION_ORDER.map(action => {
                          const key = permissionKey(module.key, action);
                          const available = availableActions.includes(action);
                          return (
                            <td key={key} className="px-3 py-2.5 text-center">
                              {available ? (
                                <input
                                  type="checkbox"
                                  checked={hasPermission(key)}
                                  onChange={() => togglePermission(key)}
                                  className="h-4 w-4 accent-[#1e3a5f]"
                                />
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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

      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف">
        <p className="text-gray-600 mb-5">هل أنت متأكد من حذف هذا المستخدم؟</p>
        <div className="flex gap-3">
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl hover:bg-red-600 transition">حذف</button>
          <button onClick={() => setDeleteConfirm(null)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
        </div>
      </Modal>
    </div>
  );
}

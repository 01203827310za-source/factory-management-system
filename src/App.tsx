import { useState } from 'react';
import type { Page } from './types';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Expenses from './pages/Expenses';
import ReadyStock from './pages/ReadyStock';
import FabricWarehouse from './pages/FabricWarehouse';
import Accessories from './pages/Accessories';
import Cutting from './pages/Cutting';
import ModelProduction from './pages/ModelProduction';
import ClientAccounts from './pages/ClientAccounts';
import Debts from './pages/Debts';
import UsersPage from './pages/Users';
import FixedAssets from './pages/FixedAssets';
import Reports from './pages/Reports';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Menu, LogOut, User, ChevronDown, KeyRound } from 'lucide-react';
import { authApi } from './services/api';
import { useToast } from './components/Toast';
import Modal from './components/Modal';
type ExtendedPage = Page | 'users';

function PageRenderer({ page }: { page: ExtendedPage }) {
  switch (page) {
    case 'dashboard':   return <Dashboard />;
    case 'sales':       return <Sales />;
    case 'expenses':    return <Expenses />;
    case 'readyStock':  return <ReadyStock />;
    case 'fabric':      return <FabricWarehouse />;
    case 'accessories': return <Accessories />;
    case 'cutting':     return <Cutting />;
    case 'modelProd':   return <ModelProduction />;
    case 'clientAccts': return <ClientAccounts />;
    case 'debts':       return <Debts />;
    case 'fixedAssets': return <FixedAssets />;
    case 'reports':     return <Reports />;
    case 'users':       return <UsersPage />;

    default:            return <Dashboard />;
  }
}

function AppContent() {
  const { user, isLoading, isAuthenticated, logout, isAdmin } = useAuth();
  const toast = useToast();
  const [currentPage, setCurrentPage] = useState<ExtendedPage>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePassModal, setChangePassModal] = useState(false);
  const [passForm, setPassForm] = useState({ current: '', next: '', confirm: '' });
  const [passLoading, setPassLoading] = useState(false);

  const handleChangePassword = async () => {
    if (!passForm.next || !passForm.current) { toast('error', 'يرجى ملء جميع الحقول'); return; }
    if (passForm.next !== passForm.confirm) { toast('error', 'كلمة المرور الجديدة غير متطابقة'); return; }
    if (passForm.next.length < 6) { toast('error', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    setPassLoading(true);
    try {
      await authApi.changePassword(passForm.current, passForm.next);
      toast('success', 'تم تغيير كلمة المرور بنجاح');
      setChangePassModal(false);
      setPassForm({ current: '', next: '', confirm: '' });
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : 'خطأ');
    } finally {
      setPassLoading(false);
    }
  };

  // Loading screen
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f2744] flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p>جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  // Login screen
  if (!isAuthenticated) return <Login />;

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      <Sidebar
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page as ExtendedPage)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        globalSearch={globalSearch}
        onSearchChange={setGlobalSearch}
        isAdmin={isAdmin}
        onUsersPage={() => setCurrentPage('users')}
      />

      {/* Mobile header toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 right-4 z-30 lg:hidden p-2.5 bg-[#1e3a5f] text-white rounded-lg shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* User info bar - top left */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-30">
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 bg-white shadow-md rounded-xl px-3 py-2 text-sm hover:bg-gray-50 transition"
          >
            <div className="w-7 h-7 bg-[#1e3a5f] rounded-full flex items-center justify-center text-white text-xs font-bold">
              {user?.full_name?.[0] || 'U'}
            </div>
            <div className="text-right hidden sm:block">
              <div className="font-semibold text-gray-800 text-xs">{user?.full_name}</div>
              <div className="text-gray-400 text-xs">{user?.role === 'admin' ? 'مدير' : user?.role === 'manager' ? 'مشرف' : 'مشاهد'}</div>
            </div>
            <ChevronDown size={14} className="text-gray-400" />
          </button>

          {userMenuOpen && (
            <div className="absolute left-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-40">
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="font-semibold text-gray-800 text-sm">{user?.full_name}</div>
                <div className="text-gray-400 text-xs">@{user?.username}</div>
              </div>
              <button
                onClick={() => { setChangePassModal(true); setUserMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                <KeyRound size={15} /> تغيير كلمة المرور
              </button>
              {isAdmin && (
                <button
                  onClick={() => { setCurrentPage('users'); setUserMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <User size={15} /> إدارة المستخدمين
                </button>
              )}
              <button
                onClick={() => { logout(); setUserMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
              >
                <LogOut size={15} /> تسجيل الخروج
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="lg:mr-64 min-h-screen transition-all">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto pt-16 lg:pt-8">
          <PageRenderer key={currentPage} page={currentPage} />
        </div>
      </main>

      {/* Change Password Modal */}
      <Modal isOpen={changePassModal} onClose={() => setChangePassModal(false)} title="تغيير كلمة المرور">
        <div className="space-y-4 p-1">
          {['current', 'next', 'confirm'].map((field) => (
            <div key={field}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field === 'current' ? 'كلمة المرور الحالية' : field === 'next' ? 'كلمة المرور الجديدة' : 'تأكيد كلمة المرور'}
              </label>
              <input
                type="password"
                value={passForm[field as keyof typeof passForm]}
                onChange={e => setPassForm({ ...passForm, [field]: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button onClick={handleChangePassword} disabled={passLoading} className="flex-1 bg-[#1e3a5f] text-white py-2.5 rounded-xl hover:bg-[#16304d] transition disabled:opacity-60">
              {passLoading ? 'جارٍ الحفظ...' : 'تغيير'}
            </button>
            <button onClick={() => setChangePassModal(false)} className="flex-1 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 transition">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* Click outside to close user menu */}
      {userMenuOpen && <div className="fixed inset-0 z-20" onClick={() => setUserMenuOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}

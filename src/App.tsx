import { useCallback, useEffect, useState } from 'react';
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
import FinancialCenter from './pages/FinancialCenter';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Payroll from './pages/Payroll';
import AuditLog from './pages/AuditLog';
import AiAssistant from './pages/AiAssistant';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Menu, LogOut, User, ChevronDown, KeyRound, Lock, Home } from 'lucide-react';
import { authApi } from './services/api';
import { useToast } from './components/Toast';
import Modal from './components/Modal';

type ExtendedPage = Page | 'users' | 'accessDenied';

function getPageFromHash(): ExtendedPage {
  if (typeof window === 'undefined') return 'dashboard';
  const hash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  switch (hash) {
    case 'sales': return 'sales';
    case 'expenses': return 'expenses';
    case 'ready-stock': return 'readyStock';
    case 'fabric': return 'fabric';
    case 'accessories': return 'accessories';
    case 'cutting': return 'cutting';
    case 'model-prod': return 'modelProd';
    case 'client-accounts': return 'clientAccts';
    case 'debts': return 'debts';
    case 'financial-center': return 'financialCenter';
    case 'fixed-assets': return 'fixedAssets';
    case 'reports': return 'reports';
    case 'payroll': return 'payroll';
    case 'audit-log': return 'auditLog';
    case 'ai-assistant': return 'aiAssistant';
    case 'users': return 'users';
    case 'access-denied':
    case 'accessdenied':
    case '403': return 'accessDenied';
    default: return 'dashboard';
  }
}

function toHash(page: ExtendedPage) {
  switch (page) {
    case 'readyStock': return '#ready-stock';
    case 'modelProd': return '#model-prod';
    case 'clientAccts': return '#client-accounts';
    case 'financialCenter': return '#financial-center';
    case 'fixedAssets': return '#fixed-assets';
    case 'auditLog': return '#audit-log';
    case 'aiAssistant': return '#ai-assistant';
    case 'accessDenied': return '#access-denied';
    case 'users': return '#users';
    default: return `#${page}`;
  }
}

function pagePermission(page: ExtendedPage) {
  const permissions: Partial<Record<ExtendedPage, string>> = {
    dashboard: 'dashboard.view',
    sales: 'sales.view',
    expenses: 'expenses.view',
    readyStock: 'ready_stock.view',
    fabric: 'fabric.view',
    accessories: 'accessories.view',
    cutting: 'cutting.view',
    modelProd: 'model_prod.view',
    clientAccts: 'client_accounts.view',
    debts: 'debts.view',
    financialCenter: 'financial_center.view',
    fixedAssets: 'assets.view',
    reports: 'reports.view',
    payroll: 'payroll.view',
    auditLog: 'audit_log.view',
    aiAssistant: 'ai_assistant.view',
    users: 'users.view',
  };
  return permissions[page];
}

function PageRenderer({ page }: { page: ExtendedPage }) {
  switch (page) {
    case 'dashboard': return <Dashboard />;
    case 'sales': return <Sales />;
    case 'expenses': return <Expenses />;
    case 'readyStock': return <ReadyStock />;
    case 'fabric': return <FabricWarehouse />;
    case 'accessories': return <Accessories />;
    case 'cutting': return <Cutting />;
    case 'modelProd': return <ModelProduction />;
    case 'clientAccts': return <ClientAccounts />;
    case 'debts': return <Debts />;
    case 'financialCenter': return <FinancialCenter />;
    case 'fixedAssets': return <FixedAssets />;
    case 'reports': return <Reports />;
    case 'payroll': return <Payroll />;
    case 'auditLog': return <AuditLog />;
    case 'aiAssistant': return <AiAssistant />;
    case 'users': return <UsersPage />;
    default: return <Dashboard />;
  }
}

function AccessDeniedScreen({ onGoHome, onGoBack }: { onGoHome: () => void; onGoBack: () => void }) {
  return (
    <div className="flex min-h-[65vh] items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-600">
          <Lock size={30} />
        </div>
        <h1 className="text-2xl font-bold text-gray-800">🔒 ليس لديك صلاحية للوصول لهذه الصفحة</h1>
        <p className="mt-3 text-sm leading-7 text-gray-600">يرجى التواصل مع مدير النظام إذا كنت تحتاج هذه الصلاحية.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            onClick={onGoHome}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#16304d]"
          >
            <Home size={16} /> العودة للرئيسية
          </button>
          <button
            onClick={onGoBack}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            رجوع
          </button>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, isLoading, isAuthenticated, logout, isAdmin, can } = useAuth();
  const toast = useToast();
  const [currentPage, setCurrentPage] = useState<ExtendedPage>(() => getPageFromHash());
  const [previousPage, setPreviousPage] = useState<ExtendedPage>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changePassModal, setChangePassModal] = useState(false);
  const [passForm, setPassForm] = useState({ current: '', next: '', confirm: '' });
  const [passLoading, setPassLoading] = useState(false);

  const showAccessDenied = useCallback((fromPage?: ExtendedPage) => {
    setPreviousPage(prev => {
      const sourcePage = fromPage ?? currentPage;
      return sourcePage === 'accessDenied' ? prev : sourcePage;
    });
    setCurrentPage('accessDenied');
    if (window.location.hash !== '#access-denied') {
      window.location.hash = '#access-denied';
    }
  }, [currentPage]);

  useEffect(() => {
    const syncFromHash = () => {
      const hashPage = getPageFromHash();
      if (hashPage === 'accessDenied') {
        setCurrentPage('accessDenied');
        return;
      }

      const permission = pagePermission(hashPage);
      if (!permission || can(permission)) {
        setCurrentPage(hashPage);
      } else {
        showAccessDenied(currentPage);
      }
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, [can, currentPage, showAccessDenied]);

  useEffect(() => {
    const handleForbidden = () => {
      showAccessDenied(currentPage);
    };

    window.addEventListener('rbac-forbidden', handleForbidden);
    return () => window.removeEventListener('rbac-forbidden', handleForbidden);
  }, [currentPage, showAccessDenied]);

  const navigateToPage = (page: ExtendedPage) => {
    if (page === 'accessDenied') return;

    const permission = pagePermission(page);
    const hasAccess = !permission || can(permission);

    if (!hasAccess) {
      showAccessDenied(currentPage);
      return;
    }

    setPreviousPage(currentPage === 'accessDenied' ? previousPage : currentPage);
    setCurrentPage(page);
    window.location.hash = toHash(page);
  };

  const handleGoHome = () => {
    setPreviousPage(currentPage === 'accessDenied' ? previousPage : currentPage);
    setCurrentPage('dashboard');
    window.location.hash = '#dashboard';
  };

  const handleGoBack = () => {
    const fallbackPage = previousPage === 'accessDenied' ? 'dashboard' : previousPage;
    navigateToPage(fallbackPage);
  };

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

  const permission = pagePermission(currentPage);
  const hasAccess = currentPage === 'accessDenied' || !permission || can(permission);

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      <Sidebar
        currentPage={currentPage}
        onNavigate={page => navigateToPage(page as ExtendedPage)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        globalSearch={globalSearch}
        onSearchChange={setGlobalSearch}
        isAdmin={isAdmin}
        onUsersPage={() => navigateToPage('users')}
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
              {can('users.view') && (
                <button
                  onClick={() => { navigateToPage('users'); setUserMenuOpen(false); }}
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
          {hasAccess ? (
            currentPage === 'accessDenied' ? (
              <AccessDeniedScreen onGoHome={handleGoHome} onGoBack={handleGoBack} />
            ) : (
              <PageRenderer key={currentPage} page={currentPage} />
            )
          ) : (
            <AccessDeniedScreen onGoHome={handleGoHome} onGoBack={handleGoBack} />
          )}
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

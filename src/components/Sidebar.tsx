import {
  LayoutDashboard, ClipboardList, DollarSign, Package, Scissors,
  Shirt, CreditCard, BadgeDollarSign, Boxes, X, Search, Users, Landmark
} from 'lucide-react';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  globalSearch: string;
  onSearchChange: (val: string) => void;
  isAdmin?: boolean;
  onUsersPage?: () => void;
}

const menuItems: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'dashboard', label: 'لوحة التحكم', icon: <LayoutDashboard size={20} /> },
  { page: 'fabric', label: 'مخزن القماش', icon: <Shirt size={20} /> },
  { page: 'readyStock', label: 'مخزن الاستوك', icon: <Package size={20} /> },
  { page: 'cutting', label: 'رقم القص', icon: <Scissors size={20} /> },
  { page: 'modelProd', label: 'رقم الموديل', icon: <Shirt size={20} /> },
  { page: 'sales', label: 'بيان المبيعات', icon: <ClipboardList size={20} /> },
  { page: 'expenses', label: 'المصاريف والإيرادات', icon: <DollarSign size={20} /> },
  { page: 'debts', label: 'الديون', icon: <CreditCard size={20} /> },
  { page: 'clientAccts', label: 'حساب عميل', icon: <BadgeDollarSign size={20} /> },
  { page: 'accessories', label: 'مخزن الإكسسوارات', icon: <Boxes size={20} /> },
];

export default function Sidebar({ currentPage, onNavigate, sidebarOpen, onToggleSidebar, globalSearch, onSearchChange, isAdmin, onUsersPage }: SidebarProps) {
  return (
    <>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onToggleSidebar} />
      )}
      
      <aside className={`fixed top-0 right-0 h-full z-50 bg-[#1e3a5f] text-white transition-all duration-300 flex flex-col
        ${sidebarOpen ? 'w-64 translate-x-0' : 'w-64 translate-x-full lg:translate-x-0 lg:w-64'}`}>
        
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center">
              <Package size={20} />
            </div>
            <div>
              <h1 className="font-bold text-sm">نظام المصنع</h1>
              <p className="text-[10px] text-white/50">إدارة متكاملة</p>
            </div>
          </div>
          <button onClick={onToggleSidebar} className="lg:hidden p-1.5 hover:bg-white/10 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={globalSearch}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="بحث عام..."
              className="w-full bg-white/10 text-white placeholder-white/40 text-sm rounded-lg pr-10 pl-3 py-2 border border-white/10 focus:outline-none focus:border-white/30"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {menuItems.map(({ page, label, icon }) => (
            <button
              key={page}
              onClick={() => {
                onNavigate(page);
                if (window.innerWidth < 1024) onToggleSidebar();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                ${currentPage === page
                  ? 'bg-white/20 text-white shadow-lg'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-white/10">
          <p className="text-[10px] text-white/30 text-center">نظام إدارة المصنع v2.0</p>
        </div>
      </aside>
    </>
  );
}

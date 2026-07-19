import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

type ToastList = ToastMessage[];

interface ToastCtxValue {
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

const ToastCtx = createContext<ToastCtxValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.addToast;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastList>([]);
  const suppressNextToastRef = useRef(false);

  useEffect(() => {
    const handleForbidden = () => {
      suppressNextToastRef.current = true;
    };

    window.addEventListener('rbac-forbidden', handleForbidden);
    return () => window.removeEventListener('rbac-forbidden', handleForbidden);
  }, []);

  const addToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    if (suppressNextToastRef.current) {
      suppressNextToastRef.current = false;
      return;
    }

    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ addToast }}>
      {children}
      <div className="fixed top-4 left-4 z-50 flex flex-col gap-2 no-print" dir="rtl">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white min-w-72 animate-slide-in ${
              toast.type === 'success' ? 'bg-emerald-600' :
              toast.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
            }`}
          >
            {toast.type === 'success' && <CheckCircle size={20} />}
            {toast.type === 'error' && <XCircle size={20} />}
            {toast.type === 'info' && <Info size={20} />}
            <span className="flex-1 text-sm font-medium">{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="opacity-70 hover:opacity-100 transition">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

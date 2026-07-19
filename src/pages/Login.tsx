import { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, Lock, User, Factory } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) {
      setError('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password);
      sessionStorage.setItem('redirect_after_login', '1');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'خطأ في تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0f2744] to-[#1e3a5f] flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 rounded-2xl mb-4 backdrop-blur-sm">
            <Factory size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">نظام إدارة المصنع</h1>
          <p className="text-blue-200 text-sm">مصنع الملابس</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6 text-center">تسجيل الدخول</h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 mb-5 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                اسم المستخدم
              </label>
              <div className="relative">
                <User size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent text-gray-800 bg-gray-50"
                  autoComplete="username"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <Lock size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent text-gray-800 bg-gray-50"
                  autoComplete="current-password"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#1e3a5f] hover:bg-[#16304d] text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> جارٍ تسجيل الدخول...</>
              ) : (
                'تسجيل الدخول'
              )}
            </button>
          </form>

          {/* Default accounts hint */}
          <div className="mt-6 pt-5 border-t border-gray-100">
            <p className="text-xs text-gray-400 text-center mb-3">الحسابات الافتراضية:</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { user: 'admin', pass: 'admin123', label: 'مدير', color: 'bg-purple-50 text-purple-700' },
                { user: 'mido', pass: 'mido123', label: 'ميدو', color: 'bg-green-50 text-green-700' },
                { user: 'nadia', pass: 'nadia123', label: 'نادية', color: 'bg-pink-50 text-pink-700' },
              ].map(acc => (
                <button
                  key={acc.user}
                  type="button"
                  onClick={() => { setUsername(acc.user); setPassword(acc.pass); }}
                  className={`${acc.color} rounded-lg p-2 text-center cursor-pointer hover:opacity-80 transition border border-current/20`}
                >
                  <div className="font-bold">{acc.label}</div>
                  <div className="opacity-70">{acc.user}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

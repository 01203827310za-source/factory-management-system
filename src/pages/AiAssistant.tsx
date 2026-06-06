// ============================================
// AI Assistant Page — المستشار الذكي
// Read-only chat interface powered by Gemini
// ============================================

import { useState, useRef, useEffect } from 'react';
import {
  Send, Sparkles, Bot, User, Copy, Check, BarChart2,
  Loader2, AlertCircle, ChevronDown, Zap,
} from 'lucide-react';
import { aiAssistantApi } from '../services/api';
import { useToast } from '../components/Toast';

// ─── types ───────────────────────────────────
interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  loading?: boolean;
  error?: boolean;
}

// ─── helpers ─────────────────────────────────
let msgId = 0;
const nextId = () => ++msgId;

function formatTime(d: Date) {
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

// ─── Markdown-light renderer (bold + bullets) ────────────────────────────────
function RenderText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1 leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        const h2 = line.match(/^#{1,3}\s+(.+)/);
        if (h2) return <p key={i} className="font-bold text-base mt-2 mb-0.5">{h2[1]}</p>;
        const bullet = line.match(/^[\-\*•]\s+(.+)/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current shrink-0 opacity-60" />
              <span>{renderInline(bullet[1])}</span>
            </div>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*(.+)\*\*$/);
    if (bold) return <strong key={i}>{bold[1]}</strong>;
    return part;
  });
}

// ─── Copy button ──────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} title="نسخ"
      className="p-1 rounded hover:bg-black/10 transition text-current opacity-50 hover:opacity-100">
      {copied ? <Check size={13}/> : <Copy size={13}/>}
    </button>
  );
}

// ─── Message bubble ───────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold
        ${isUser ? 'bg-[#1e3a5f]' : 'bg-gradient-to-br from-violet-600 to-indigo-600'}`}>
        {isUser ? <User size={15}/> : <Bot size={15}/>}
      </div>
      <div className={`max-w-[80%] group ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`rounded-2xl px-4 py-3 text-sm shadow-sm
          ${isUser
            ? 'bg-[#1e3a5f] text-white rounded-tr-sm'
            : msg.error
              ? 'bg-red-50 text-red-800 border border-red-200 rounded-tl-sm'
              : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
          }`}>
          {msg.loading ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 size={15} className="animate-spin"/>
              <span className="text-xs">جارٍ التفكير...</span>
            </div>
          ) : msg.error ? (
            <div className="flex items-center gap-2">
              <AlertCircle size={15}/>
              <span>{msg.text}</span>
            </div>
          ) : isUser ? (
            <p>{msg.text}</p>
          ) : (
            <RenderText text={msg.text}/>
          )}
        </div>
        <div className={`flex items-center gap-1.5 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[10px] text-gray-400">{formatTime(msg.timestamp)}</span>
          {!isUser && !msg.loading && !msg.error && <CopyBtn text={msg.text}/>}
        </div>
      </div>
    </div>
  );
}

// ============================================
// QUICK ACTIONS PANEL
// ============================================

interface QItem { label: string; q: string }
interface Category {
  id: string;
  icon: string;
  label: string;
  highlight?: boolean;
  questions: QItem[];
}

const CATEGORIES: Category[] = [
  {
    id: 'sales',
    icon: '📊',
    label: 'المبيعات',
    questions: [
      { label: 'إجمالي المبيعات',           q: 'كام إجمالي المبيعات؟' },
      { label: 'مبيعات اليوم',               q: 'كام مبيعات اليوم؟' },
      { label: 'مبيعات هذا الشهر',           q: 'كام مبيعات هذا الشهر؟' },
      { label: 'أكثر موديل مبيعاً',          q: 'ما هو أكثر موديل مبيعاً؟' },
      { label: 'أقل موديل مبيعاً',           q: 'ما هو أقل موديل مبيعاً؟' },
      { label: 'أعلى فاتورة بيع',            q: 'ما هي أعلى فاتورة بيع؟' },
      { label: 'عدد الأوردرات المصروفة',     q: 'كام عدد الأوردرات المصروفة؟' },
      { label: 'عدد الأوردرات المحجوزة',     q: 'كام عدد الأوردرات المحجوزة؟' },
      { label: 'عدد الأوردرات الملغية',      q: 'كام عدد الأوردرات الملغية؟' },
      { label: 'متوسط قيمة الأوردر',         q: 'كام متوسط قيمة الأوردر؟' },
    ],
  },
  {
    id: 'inventory',
    icon: '📦',
    label: 'المخزون',
    questions: [
      { label: 'قيمة الاستوك الحالية',         q: 'كام قيمة الاستوك الحالية؟' },
      { label: 'كمية كل موديل بالمخزن',        q: 'ما هي كمية كل موديل بالمخزن؟' },
      { label: 'الموديلات التي قاربت على النفاد', q: 'ما هي الموديلات التي قاربت على النفاد؟' },
      { label: 'أكثر موديل متوفر',              q: 'ما هو أكثر موديل متوفراً بالمخزن؟' },
      { label: 'أقل موديل متوفر',               q: 'ما هو أقل موديل متوفراً بالمخزن؟' },
      { label: 'إجمالي قيمة القماش',            q: 'كام إجمالي قيمة القماش بالمخزن؟' },
      { label: 'إجمالي قيمة الإكسسوارات',       q: 'كام إجمالي قيمة الإكسسوارات؟' },
      { label: 'إجمالي الأصول الحالية',         q: 'كام إجمالي الأصول الحالية للمصنع؟' },
    ],
  },
  {
    id: 'financial',
    icon: '💰',
    label: 'المالية',
    questions: [
      { label: 'الوضع المالي الحالي',          q: 'ما هو الوضع المالي الحالي للمصنع؟' },
      { label: 'صافي الربح',                   q: 'كام صافي الربح؟' },
      { label: 'إجمالي الإيرادات',             q: 'كام إجمالي الإيرادات؟' },
      { label: 'إجمالي المصروفات',             q: 'كام إجمالي المصروفات؟' },
      { label: 'الكاش المتاح',                 q: 'كام الكاش المتاح حالياً؟' },
      { label: 'الفلوس اللي لينا برا',          q: 'كام الفلوس اللي لينا برا (الديون المستحقة لنا)؟' },
      { label: 'أكبر المصروفات',               q: 'ما هي أكبر المصروفات؟' },
      { label: 'المصروفات حسب النوع',           q: 'ما هي المصروفات مصنفة حسب النوع؟' },
      { label: 'مقارنة آخر شهر بالسابق',       q: 'قارن أداء آخر شهر بالشهر السابق' },
    ],
  },
  {
    id: 'debts',
    icon: '🧾',
    label: 'الديون والحسابات',
    questions: [
      { label: 'إجمالي الديون المتبقية',       q: 'كام إجمالي الديون المتبقية؟' },
      { label: 'أكبر دائن',                    q: 'من هو أكبر دائن لدينا؟' },
      { label: 'أقرب ديون للسداد',             q: 'ما هي أقرب الديون للسداد؟' },
      { label: 'حسابات العملاء المتبقية',      q: 'كام إجمالي حسابات العملاء المتبقية؟' },
      { label: 'أكبر عميل مدين',               q: 'من هو أكبر عميل مدين؟' },
      { label: 'العملاء المتأخرون في السداد',   q: 'من هم العملاء المتأخرون في السداد؟' },
    ],
  },
  {
    id: 'marketers',
    icon: '👨‍💼',
    label: 'المسوقين',
    questions: [
      { label: 'أفضل مسوق',            q: 'من هو أفضل مسوق؟' },
      { label: 'ترتيب المسوقين',        q: 'ما هو ترتيب المسوقين حسب الأداء؟' },
      { label: 'مبيعات كل مسوق',       q: 'كام مبيعات كل مسوق؟' },
      { label: 'أعلى أداء تسويقي',     q: 'من يمتلك أعلى مبيعات بين المسوقين؟' },
      { label: 'أقل أداء تسويقي',      q: 'من هو أقل مسوق أداءً؟' },
    ],
  },
  {
    id: 'production',
    icon: '🏭',
    label: 'الإنتاج',
    questions: [
      { label: 'إجمالي الإنتاج',          q: 'كام إجمالي الإنتاج؟' },
      { label: 'أكثر موديل تم إنتاجه',    q: 'ما هو أكثر موديل تم إنتاجه؟' },
      { label: 'استهلاك القماش',           q: 'كام إجمالي استهلاك القماش؟' },
      { label: 'كفاءة الإنتاج الحالية',    q: 'ما هي كفاءة الإنتاج الحالية؟' },
      { label: 'عدد عمليات القص',          q: 'كام عدد عمليات القص؟' },
      { label: 'أكثر خامة استهلاكاً',      q: 'ما هي أكثر خامة استهلاكاً؟' },
    ],
  },
  {
    id: 'partners',
    icon: '👥',
    label: 'الشركاء',
    questions: [
      { label: 'ملخص الشركاء',           q: 'ما هو ملخص وضع الشركاء؟' },
      { label: 'صافي عهدة حاتم',          q: 'كام صافي عهدة حاتم؟' },
      { label: 'صافي عهدة ميدو',          q: 'كام صافي عهدة ميدو؟' },
      { label: 'مقارنة عهدة الشركاء',     q: 'قارن بين عهدة حاتم وميدو' },
      { label: 'تحليل حركة الشركاء',      q: 'حلل حركة الشركاء المالية' },
    ],
  },
  {
    id: 'ai',
    icon: '🤖',
    label: 'التحليل الذكي',
    highlight: true,
    questions: [
      { label: 'حلل وضع المصنع الحالي',         q: 'حلل وضع المصنع الحالي بالتفصيل' },
      { label: 'ما أكبر المخاطر المالية؟',       q: 'ما هي أكبر المخاطر المالية التي يواجهها المصنع؟' },
      { label: 'كيف أزيد الربحية؟',              q: 'كيف يمكن زيادة ربحية المصنع؟' },
      { label: 'ما أسباب انخفاض الأرباح؟',       q: 'ما هي أسباب انخفاض الأرباح؟' },
      { label: 'هل يوجد ركود في المبيعات؟',      q: 'هل يوجد ركود في المبيعات؟ حلل الوضع' },
      { label: 'المنتجات التي يجب التركيز عليها', q: 'ما هي المنتجات التي يجب التركيز عليها؟' },
      { label: 'تقرير تنفيذي كامل',               q: 'أعطني تقريراً تنفيذياً كاملاً عن المصنع' },
      { label: 'أهم 5 مؤشرات أداء',               q: 'ما هي أهم 5 مؤشرات أداء بالمصنع؟' },
      { label: 'توقع أداء الشهر القادم',           q: 'توقع أداء المصنع في الشهر القادم بناءً على البيانات الحالية' },
      { label: 'قرارات لتحسين السيولة',            q: 'اقترح قرارات عملية لتحسين السيولة المالية للمصنع' },
    ],
  },
];

// ─── Quick Actions Panel ──────────────────────────────────────────────────────
function QuickActionsPanel({ onSend, disabled }: { onSend: (q: string) => void; disabled: boolean }) {
  const [panelOpen, setPanelOpen]  = useState(true);
  const [openCats, setOpenCats]    = useState<Set<string>>(() => new Set(['sales']));

  const toggleCat = (id: string) =>
    setOpenCats(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const totalQ = CATEGORIES.reduce((s, c) => s + c.questions.length, 0);

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm mt-3">

      {/* Panel toggle bar */}
      <button
        onClick={() => setPanelOpen(p => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors group"
      >
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-violet-600"/>
          <span className="text-xs font-semibold text-gray-700">أسئلة سريعة</span>
          <span className="text-[10px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full font-medium">
            {totalQ} سؤال
          </span>
        </div>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 ${panelOpen ? '' : '-rotate-180'}`}
        />
      </button>

      {/* Categories */}
      {panelOpen && (
        <div className="overflow-y-auto max-h-64 divide-y divide-gray-50">
          {CATEGORIES.map(cat => {
            const isOpen = openCats.has(cat.id);
            return (
              <div key={cat.id}>
                {/* Category header */}
                <button
                  onClick={() => toggleCat(cat.id)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-right transition-colors
                    ${cat.highlight
                      ? 'bg-gradient-to-l from-violet-50 to-indigo-50 hover:from-violet-100 hover:to-indigo-100'
                      : 'hover:bg-gray-50'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm leading-none">{cat.icon}</span>
                    <span className={`text-xs font-semibold ${cat.highlight ? 'text-violet-700' : 'text-gray-700'}`}>
                      {cat.label}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full
                      ${cat.highlight ? 'bg-violet-100 text-violet-500' : 'bg-gray-100 text-gray-400'}`}>
                      {cat.questions.length}
                    </span>
                  </div>
                  <ChevronDown
                    size={12}
                    className={`transition-transform duration-200 flex-shrink-0
                      ${cat.highlight ? 'text-violet-400' : 'text-gray-300'}
                      ${isOpen ? '' : '-rotate-90'}`}
                  />
                </button>

                {/* Questions */}
                {isOpen && (
                  <div className={`px-4 pb-3 pt-1.5 flex flex-wrap gap-1.5
                    ${cat.highlight ? 'bg-gradient-to-l from-violet-50/40 to-indigo-50/40' : 'bg-gray-50/50'}`}>
                    {cat.questions.map(item => (
                      <button
                        key={item.label}
                        onClick={() => onSend(item.q)}
                        disabled={disabled}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all disabled:opacity-40 disabled:cursor-not-allowed
                          ${cat.highlight
                            ? 'bg-white border-violet-200 text-violet-700 hover:bg-violet-600 hover:text-white hover:border-violet-600'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-[#1e3a5f] hover:text-white hover:border-[#1e3a5f]'
                          }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────
export default function AiAssistant() {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(), role: 'assistant', timestamp: new Date(),
      text: 'مرحباً! أنا المستشار الذكي لمصنعك 🏭\nيمكنني تحليل بيانات المصنع والإجابة على أسئلتك بشأن المبيعات والمخزون والديون والمالية والموظفين.\nاستخدم الأسئلة السريعة أدناه أو اكتب سؤالك مباشرة.',
    },
  ]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMsg = (msg: Omit<Message, 'id' | 'timestamp'>) =>
    setMessages(prev => [...prev, { ...msg, id: nextId(), timestamp: new Date() }]);

  const updateLast = (update: Partial<Message>) =>
    setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, ...update } : m));

  // ── unchanged AI logic ──────────────────────────────────────────────────────
  const sendQuestion = async (question: string) => {
    if (!question.trim() || loading) return;
    setInput('');
    setLoading(true);
    addMsg({ role: 'user', text: question });
    addMsg({ role: 'assistant', text: '', loading: true });
    try {
      const res = await aiAssistantApi.ask(question);
      updateLast({ text: res.answer, loading: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ في الاتصال بالذكاء الاصطناعي';
      updateLast({ text: msg, loading: false, error: true });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleAnalyze = async () => {
    if (analyzing) return;
    setAnalyzing(true);
    addMsg({ role: 'user', text: 'تحليل المصنع — أنشئ تقرير إداري شامل' });
    addMsg({ role: 'assistant', text: '', loading: true });
    try {
      const res = await aiAssistantApi.analyzeFactory();
      updateLast({ text: res.answer, loading: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ في التحليل';
      updateLast({ text: msg, loading: false, error: true });
      toast('error', msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(input); }
  };
  // ── end unchanged AI logic ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[500px]" dir="rtl">

      {/* Header — unchanged */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow">
            <Sparkles size={20} className="text-white"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">المستشار الذكي</h1>
            <p className="text-xs text-gray-400">مدعوم بـ Gemini 2.5 Flash · قراءة فقط</p>
          </div>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={analyzing || loading}
          className="flex items-center gap-2 bg-gradient-to-l from-violet-600 to-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow hover:opacity-90 transition disabled:opacity-50"
        >
          {analyzing ? <Loader2 size={15} className="animate-spin"/> : <BarChart2 size={15}/>}
          تحليل المصنع
        </button>
      </div>

      {/* Chat area — unchanged */}
      <div className="flex-1 bg-gray-50 rounded-2xl border border-gray-100 overflow-y-auto p-4 space-y-4">
        {messages.map(msg => <Bubble key={msg.id} msg={msg}/>)}
        <div ref={bottomRef}/>
      </div>

      {/* Input bar — unchanged */}
      <div className="mt-3 flex gap-3 items-end">
        <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm focus-within:border-[#1e3a5f] focus-within:ring-2 focus-within:ring-[#1e3a5f]/10 transition overflow-hidden">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="اكتب سؤالك هنا... (Enter للإرسال، Shift+Enter لسطر جديد)"
            rows={1}
            className="w-full px-4 py-3 text-sm resize-none focus:outline-none bg-transparent max-h-32"
            style={{ minHeight: '48px' }}
            disabled={loading}
          />
        </div>
        <button
          onClick={() => sendQuestion(input)}
          disabled={!input.trim() || loading}
          className="w-12 h-12 bg-[#1e3a5f] text-white rounded-2xl flex items-center justify-center shadow hover:bg-[#16304d] transition disabled:opacity-40 shrink-0"
        >
          {loading ? <Loader2 size={18} className="animate-spin"/> : <Send size={18}/>}
        </button>
      </div>

      {/* Quick Actions Panel — NEW */}
      <QuickActionsPanel onSend={sendQuestion} disabled={loading || analyzing}/>

      <p className="text-center text-[10px] text-gray-300 mt-2">
        المستشار الذكي للقراءة والتحليل فقط · لا يمكنه تعديل أي بيانات
      </p>
    </div>
  );
}

// ============================================
// AI Assistant Page — المستشار الذكي
// Read-only chat interface powered by Gemini
// ============================================

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, Bot, User, Copy, Check, BarChart2, Loader2, AlertCircle } from 'lucide-react';
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

// ─── suggested questions ──────────────────────
const SUGGESTED: { label: string; question: string }[] = [
  { label: 'إجمالي المبيعات',       question: 'كام إجمالي المبيعات؟' },
  { label: 'قيمة الاستوك',           question: 'كام قيمة الاستوك الحالية؟' },
  { label: 'أفضل مسوق',              question: 'مين أفضل مسوق؟' },
  { label: 'قيمة القماش',            question: 'كام قيمة القماش بالمخزن؟' },
  { label: 'الديون المتبقية',         question: 'كام الديون المتبقية؟' },
  { label: 'الحجوزات الحالية',        question: 'كام عدد وقيمة الحجوزات الحالية؟' },
  { label: 'الوضع المالي',            question: 'ما هو الوضع المالي الحالي للمصنع؟' },
  { label: 'تكلفة الرواتب',           question: 'كام التكلفة المتوقعة للرواتب هذا الشهر؟' },
];

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

        // Heading: ## or **text**
        const h2 = line.match(/^#{1,3}\s+(.+)/);
        if (h2) return <p key={i} className="font-bold text-base mt-2 mb-0.5">{h2[1]}</p>;

        // Bullet
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
      {/* Avatar */}
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold
        ${isUser ? 'bg-[#1e3a5f]' : 'bg-gradient-to-br from-violet-600 to-indigo-600'}`}>
        {isUser ? <User size={15}/> : <Bot size={15}/>}
      </div>

      {/* Bubble */}
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

// ─── Main Page ────────────────────────────────
export default function AiAssistant() {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(), role: 'assistant', timestamp: new Date(),
      text: 'مرحباً! أنا المستشار الذكي لمصنعك 🏭\nيمكنني تحليل بيانات المصنع والإجابة على أسئلتك بشأن المبيعات والمخزون والديون والمالية والموظفين.\nكيف يمكنني مساعدتك؟',
    },
  ]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  const showSuggestions = messages.length <= 2;

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] min-h-[500px]" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow">
            <Sparkles size={20} className="text-white"/>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">المستشار الذكي</h1>
            <p className="text-xs text-gray-400">مدعوم بـ Gemini 2.5 Pro · قراءة فقط</p>
          </div>
        </div>

        {/* Phase 2: Factory Analysis button */}
        <button
          onClick={handleAnalyze}
          disabled={analyzing || loading}
          className="flex items-center gap-2 bg-gradient-to-l from-violet-600 to-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow hover:opacity-90 transition disabled:opacity-50"
        >
          {analyzing ? <Loader2 size={15} className="animate-spin"/> : <BarChart2 size={15}/>}
          تحليل المصنع
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 bg-gray-50 rounded-2xl border border-gray-100 overflow-y-auto p-4 space-y-4">

        {messages.map(msg => <Bubble key={msg.id} msg={msg}/>)}

        {/* Suggested questions — shown only near the start */}
        {showSuggestions && (
          <div className="pt-2">
            <p className="text-xs text-gray-400 mb-2 px-1">أسئلة مقترحة:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED.map(s => (
                <button
                  key={s.label}
                  onClick={() => sendQuestion(s.question)}
                  disabled={loading}
                  className="bg-white border border-gray-200 text-gray-700 text-xs px-3 py-1.5 rounded-full hover:bg-[#1e3a5f] hover:text-white hover:border-[#1e3a5f] transition disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Input bar */}
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

      <p className="text-center text-[10px] text-gray-300 mt-2">
        المستشار الذكي للقراءة والتحليل فقط · لا يمكنه تعديل أي بيانات
      </p>
    </div>
  );
}

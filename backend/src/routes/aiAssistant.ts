// ============================================
// AI Assistant Route — المستشار الذكي
// POST /api/ai-assistant
//
// READ-ONLY GUARANTEE:
//   • Only prisma.*findMany() calls — zero writes
//   • No create / update / delete / upsert / executeRaw
//   • Gemini receives aggregated numbers only, never raw rows
// ============================================

import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate);

const TIMEOUT_MS = 30_000; // 30 seconds hard cap per Gemini attempt

// ─── Timeout wrapper ─────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─── Retry config ─────────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [0, 2_000, 5_000]; // attempt 1 → immediate, 2 → 2s, 3 → 5s
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('QUOTA') ||
    msg.includes('quota') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('ETIMEDOUT') ||
    msg === 'TIMEOUT'
  );
}

async function callGeminiWithRetry(
  model: ReturnType<typeof getGemini>,
  prompt: string,
): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) await delay(RETRY_DELAYS_MS[attempt]);

    const start = Date.now();
    try {
      const result = await withTimeout(model.generateContent(prompt), TIMEOUT_MS);
      return result.response.text();
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[AI] attempt ${attempt + 1}/${RETRY_DELAYS_MS.length} failed after ${duration}ms — ${msg}`);
      lastErr = err;
      if (!isRetryable(err)) throw err; // 401 / 403 / 422 — don't retry
    }
  }

  throw lastErr; // all retries exhausted
}

// ─── Gemini client — lazy, never throws at module load ───────────────────────
function getGemini() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'your-gemini-api-key-here') {
    const err = new Error('MISSING_KEY');
    throw err;
  }
  return new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-2.5-flash' });
}

// ─── Arabic error messages ────────────────────────────────────────────────────
function toArabicError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg === 'MISSING_KEY')
    return { status: 503, message: 'خدمة الذكاء الاصطناعي غير مفعّلة — يرجى ضبط GEMINI_API_KEY في ملف .env' };

  if (msg === 'TIMEOUT')
    return { status: 504, message: 'خدمة الذكاء الاصطناعي مشغولة حالياً، حاول مرة أخرى بعد دقيقة.' };

  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid'))
    return { status: 401, message: 'مفتاح Gemini API غير صالح — يرجى مراجعة الإعدادات' };

  if (msg.includes('QUOTA') || msg.includes('quota') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED'))
    return { status: 429, message: 'خدمة الذكاء الاصطناعي مشغولة حالياً، حاول مرة أخرى بعد دقيقة.' };

  if (msg.includes('SAFETY') || msg.includes('blocked'))
    return { status: 422, message: 'تم رفض الطلب بسبب فلتر الأمان — يرجى إعادة صياغة السؤال' };

  if (msg.includes('UNAVAILABLE') || msg.includes('503'))
    return { status: 503, message: 'خدمة الذكاء الاصطناعي مشغولة حالياً، حاول مرة أخرى بعد دقيقة.' };

  if (msg.includes('ETIMEDOUT') || msg === 'TIMEOUT')
    return { status: 504, message: 'خدمة الذكاء الاصطناعي مشغولة حالياً، حاول مرة أخرى بعد دقيقة.' };

  return { status: 500, message: 'خطأ في الاتصال بالذكاء الاصطناعي — يرجى المحاولة مرة أخرى' };
}

// ─── Gather factory snapshot (READ-ONLY) ─────────────────────────────────────
// All calls are findMany — no writes anywhere in this function
async function gatherSnapshot() {
  const [
    sales, expenses, debts, clientAccts, returns_,
    paymentLogs, fabric, readyStock, accessories,
    cuttingOrders, modelProds,
    employees, productions, advances, deductions, bonuses,
  ] = await Promise.all([
    prisma.sale.findMany(),
    prisma.expenseRevenue.findMany(),
    prisma.debt.findMany(),
    prisma.clientAccount.findMany(),
    prisma.returnItem.findMany(),
    prisma.paymentLog.findMany(),
    prisma.fabricWarehouse.findMany(),
    prisma.readyStock.findMany(),
    prisma.accessoriesWarehouse.findMany(),
    prisma.cuttingOrder.findMany(),
    prisma.modelProduction.findMany(),
    prisma.employee.findMany(),
    prisma.employeeProduction.findMany(),
    prisma.employeeAdvance.findMany(),
    prisma.employeeDeduction.findMany(),
    prisma.employeeBonus.findMany(),
  ]);

  // ── Sales metrics ──────────────────────────────────────────────────────────
  const totalSalesValue   = sales.reduce((s, x) => s + x.invoice_value, 0);
  const totalDeposits     = sales.reduce((s, x) => s + x.deposit_paid, 0);
  const totalRemaining    = sales.filter(x => x.order_status === 'لم يتم الصرف').reduce((s, x) => s + x.remaining, 0);
  const reservationsCount = sales.filter(x => x.order_status === 'تم الحجز').length;
  const reservationsValue = sales.filter(x => x.order_status === 'تم الحجز').reduce((s, x) => s + x.invoice_value, 0);
  const dispatchedCount   = sales.filter(x => x.order_status === 'تم الصرف').length;
  const pendingCount      = sales.filter(x => x.order_status === 'لم يتم الصرف').length;
  const cancelledCount    = sales.filter(x => x.order_status === 'تم الإلغاء').length;

  const salesByMarketer: Record<string, number> = {};
  sales.forEach(s => { salesByMarketer[s.marketer] = (salesByMarketer[s.marketer] || 0) + s.invoice_value; });
  const bestMarketer = Object.entries(salesByMarketer).sort((a, b) => b[1] - a[1])[0];

  // ── Financial metrics ──────────────────────────────────────────────────────
  const hatemDepositIn = sales.filter(s => s.deposit_receiver === 'حاتم').reduce((s, x) => s + x.deposit_paid, 0);
  const midoDepositIn  = sales.filter(s => s.deposit_receiver === 'ميدو').reduce((s, x) => s + x.deposit_paid, 0);
  const hatemRemaining = sales.filter(s => s.order_status === 'تم الصرف').reduce((s, x) => s + x.remaining, 0);
  const hatemPaymentIn = paymentLogs.filter(p => p.receiver === 'حاتم' && p.type === 'client_payment').reduce((s, p) => s + p.amount, 0);
  const midoPaymentIn  = paymentLogs.filter(p => p.receiver === 'ميدو' && p.type === 'client_payment').reduce((s, p) => s + p.amount, 0);
  const hatemDebtOut   = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'حاتم').reduce((s, p) => s + p.amount, 0);
  const midoDebtOut    = paymentLogs.filter(p => p.type === 'debt_payment' && p.receiver === 'ميدو').reduce((s, p) => s + p.amount, 0);
  const hatemReturnOut = returns_.filter(r => r.paid_by === 'حاتم').reduce((s, r) => s + r.refund_amount, 0);
  const midoReturnOut  = returns_.filter(r => r.paid_by === 'ميدو').reduce((s, r) => s + r.refund_amount, 0);

  const hatemIn  = expenses.reduce((s, e) => s + e.hatem_in, 0)  + hatemDepositIn + hatemRemaining + hatemPaymentIn;
  const hatemOut = expenses.reduce((s, e) => s + e.hatem_out, 0) + hatemDebtOut   + hatemReturnOut;
  const midoIn   = expenses.reduce((s, e) => s + e.mido_in, 0)   + midoDepositIn  + midoPaymentIn;
  const midoOut  = expenses.reduce((s, e) => s + e.mido_out, 0)  + midoDebtOut    + midoReturnOut;
  const totalIn  = hatemIn + midoIn;
  const totalOut = hatemOut + midoOut;
  const netCash  = totalIn - totalOut;

  // ── Debts ──────────────────────────────────────────────────────────────────
  const totalDebtsRemaining = debts.reduce((s, d) => s + d.remaining, 0);
  const totalDebtsPaid      = debts.reduce((s, d) => s + d.amount_paid, 0);
  const debtors = debts.filter(d => d.remaining > 0).map(d => ({ name: d.name, remaining: d.remaining }));

  // ── Client accounts ────────────────────────────────────────────────────────
  const clientAccountsRemaining = clientAccts.reduce((s, c) => s + c.remaining, 0);

  // ── Fabric warehouse ───────────────────────────────────────────────────────
  const fabricConsumed: Record<string, number> = {};
  cuttingOrders.forEach(c => {
    const key = `${c.material_type}|${c.color}`;
    fabricConsumed[key] = (fabricConsumed[key] || 0) + c.kg_consumed;
  });
  let fabricValue = 0;
  const fabricSummary: { type: string; color: string; available_kg: number; value: number }[] = [];
  fabric.forEach(f => {
    const consumed  = fabricConsumed[`${f.material_type}|${f.color}`] || 0;
    const available = Math.max(0, f.qty_in - consumed);
    const value     = available * f.cost_per_kg;
    fabricValue += value;
    fabricSummary.push({ type: f.material_type, color: f.color, available_kg: available, value });
  });

  // ── Ready stock ────────────────────────────────────────────────────────────
  const newProd: Record<string, number> = {};
  modelProds.forEach(m => {
    if (m.status === 'تام') newProd[m.model_code] = (newProd[m.model_code] || 0) + m.qty_received;
  });
  const totalSalesQty: Record<string, number> = {};
  sales.forEach(s => {
    [1, 2, 3, 4, 5].forEach(i => {
      const code = s[`model${i}_code` as keyof typeof s] as string;
      const qty  = s[`model${i}_qty`  as keyof typeof s] as number;
      if (code && qty) totalSalesQty[code] = (totalSalesQty[code] || 0) + qty;
    });
  });
  let stockValue = 0;
  const stockSummary: { code: string; name: string; available: number; value: number }[] = [];
  readyStock.forEach(rs => {
    const produced  = newProd[rs.model_code] || 0;
    const sold      = totalSalesQty[rs.model_code] || 0;
    const available = Math.max(0, rs.opening_balance + produced - sold);
    const value     = available * rs.cost_per_piece;
    stockValue += value;
    if (available > 0) stockSummary.push({ code: rs.model_code, name: rs.product_name, available, value });
  });

  // ── Accessories ────────────────────────────────────────────────────────────
  const accessoriesValue = accessories.reduce((s, a) => s + Math.max(0, a.qty_in - a.qty_consumed) * a.cost, 0);

  // ── Total current assets ───────────────────────────────────────────────────
  const totalCurrentAssets = fabricValue + stockValue + accessoriesValue + netCash;

  // ── Payroll (current month) ────────────────────────────────────────────────
  const now        = new Date();
  const curMM      = String(now.getMonth() + 1).padStart(2, '0');
  const curYY      = now.getFullYear();
  const monthStart = `${curYY}-${curMM}-01`;
  const monthEnd   = `${curYY}-${curMM}-${String(new Date(curYY, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const inMonth    = (d: string) => d >= monthStart && d <= monthEnd;

  const monthlyAdvances   = advances.filter(a => inMonth(a.date)).reduce((s, a) => s + a.amount, 0);
  const monthlyDeductions = deductions.filter(d => inMonth(d.date)).reduce((s, d) => s + d.amount, 0);
  const monthlyBonuses    = bonuses.filter(b => inMonth(b.date)).reduce((s, b) => s + b.amount, 0);
  const monthlyProduction = productions.filter(p => inMonth(p.date)).reduce((s, p) => s + p.production_value, 0);
  const fixedSalaries     = employees.filter(e => e.employee_type === 'fixed' && e.status === 'active').reduce((s, e) => s + e.base_salary, 0);
  const estimatedPayroll  = fixedSalaries + monthlyProduction + monthlyBonuses - monthlyAdvances - monthlyDeductions;

  return {
    date: now.toISOString().slice(0, 10),
    sales: {
      total_value: totalSalesValue,
      total_deposits: totalDeposits,
      total_remaining_unpaid: totalRemaining,
      orders_dispatched: dispatchedCount,
      orders_pending: pendingCount,
      orders_reserved: reservationsCount,
      reservations_value: reservationsValue,
      orders_cancelled: cancelledCount,
      best_marketer: bestMarketer ? { name: bestMarketer[0], value: bestMarketer[1] } : null,
      by_marketer: salesByMarketer,
    },
    financial: {
      total_in: totalIn,
      total_out: totalOut,
      net_cash: netCash,
      hatem_net: hatemIn - hatemOut,
      mido_net: midoIn - midoOut,
    },
    debts: {
      total_remaining: totalDebtsRemaining,
      total_paid: totalDebtsPaid,
      active_debtors: debtors.slice(0, 10),
    },
    client_accounts: {
      total_remaining: clientAccountsRemaining,
    },
    inventory: {
      fabric_value: fabricValue,
      stock_value: stockValue,
      accessories_value: accessoriesValue,
      total_current_assets: totalCurrentAssets,
      fabric_items: fabricSummary.slice(0, 15),
      stock_items: stockSummary.slice(0, 15),
    },
    payroll: {
      active_employees: employees.filter(e => e.status === 'active').length,
      fixed_employees: employees.filter(e => e.employee_type === 'fixed' && e.status === 'active').length,
      piecework_employees: employees.filter(e => e.employee_type === 'piecework' && e.status === 'active').length,
      monthly_fixed_salaries: fixedSalaries,
      monthly_production_value: monthlyProduction,
      monthly_advances: monthlyAdvances,
      monthly_deductions: monthlyDeductions,
      monthly_bonuses: monthlyBonuses,
      estimated_monthly_cost: estimatedPayroll,
    },
  };
}

// ─── Topic classification ─────────────────────────────────────────────────────
function classifyQuestion(q: string): string[] {
  const topics: string[] = [];
  if (/مبيع|بيع|أوردر|طلب|مسوق|حجز|صرف|إلغاء/.test(q))     topics.push('sales');
  if (/مال|نقد|دخل|خرج|حاتم|ميدو|صافي|كاش|موازن/.test(q))  topics.push('financial');
  if (/دين|ديون|مديون/.test(q))                               topics.push('debts');
  if (/عميل|حساب/.test(q))                                    topics.push('client_accounts');
  if (/قماش|نسيج|خام/.test(q))                                topics.push('fabric');
  if (/استوك|منتج|مخزن|بضاعة|موديل/.test(q))                 topics.push('stock');
  if (/إكسسوار|اكسسوار/.test(q))                              topics.push('accessories');
  if (/موظف|راتب|سلف|خصم|مكافأة|مرتب|بالقطعة/.test(q))       topics.push('payroll');
  if (topics.length === 0) topics.push('all');
  return topics;
}

// ─── Build topic-filtered context ────────────────────────────────────────────
function buildContext(snap: Awaited<ReturnType<typeof gatherSnapshot>>, topics: string[]) {
  const all = topics.includes('all');
  const ctx: Record<string, unknown> = { date: snap.date };
  if (all || topics.includes('sales'))           ctx.sales           = snap.sales;
  if (all || topics.includes('financial'))       ctx.financial       = snap.financial;
  if (all || topics.includes('debts'))           ctx.debts           = snap.debts;
  if (all || topics.includes('client_accounts')) ctx.client_accounts = snap.client_accounts;
  if (all || topics.includes('fabric'))          ctx.fabric          = { fabric_value: snap.inventory.fabric_value, items: snap.inventory.fabric_items };
  if (all || topics.includes('stock'))           ctx.stock           = { stock_value: snap.inventory.stock_value, items: snap.inventory.stock_items };
  if (all || topics.includes('accessories'))     ctx.accessories     = { accessories_value: snap.inventory.accessories_value };
  if (all || topics.includes('payroll'))         ctx.payroll         = snap.payroll;
  if (all) ctx.inventory_summary = {
    total_current_assets: snap.inventory.total_current_assets,
    fabric_value: snap.inventory.fabric_value,
    stock_value: snap.inventory.stock_value,
    accessories_value: snap.inventory.accessories_value,
  };
  return ctx;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `أنت مستشار ذكي متخصص في إدارة مصانع الملابس. دورك هو تحليل بيانات المصنع والإجابة بطريقة واضحة ومفيدة.

قواعد مهمة:
- أجب دائماً باللغة العربية
- استخدم الأرقام من البيانات المرفقة فقط
- إذا لم تجد البيانات المطلوبة، اعتذر بوضوح
- لا تخترع أو تخمن أرقاماً
- نسّق الأرقام بشكل مقروء (مثل: 12,500 ج.م)
- أجب بإيجاز وبشكل مباشر ما لم يُطلب منك تفصيل
- يمكنك اقتراح تحليلات إضافية مفيدة
- أنت للقراءة والتحليل فقط — لا تملك صلاحية تعديل أي بيانات`;

const ANALYSIS_PROMPT = `أنت مستشار ذكي متخصص في إدارة مصانع الملابس. بناءً على البيانات المرفقة، اكتب تقرير إداري شامل يتضمن:

1. **ملخص الأداء** — أبرز مؤشرات الأداء الرئيسية
2. **المبيعات** — الأداء الإجمالي، الأوردرات المعلقة، أفضل مسوق
3. **الوضع المالي** — صافي التدفق النقدي، وضع كل شريك
4. **المخزون** — قيمة كل مكوّن، إجمالي الأصول الجارية
5. **الديون** — الديون المتبقية، أبرز المديونين
6. **الموظفون** — عدد الموظفين، التكلفة المتوقعة هذا الشهر
7. **التنبيهات** — أي مؤشرات تستحق الانتباه
8. **التوصيات** — 2-3 توصيات عملية قابلة للتنفيذ

اكتب بأسلوب مهني ومباشر باللغة العربية.`;

// ─── POST /api/ai-assistant ───────────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const { question, mode } = req.body as { question?: string; mode?: string };

    if (!question?.trim()) {
      res.status(400).json({ message: 'السؤال مطلوب ولا يمكن أن يكون فارغاً' });
      return;
    }
    if (question.length > 1000) {
      res.status(400).json({ message: 'السؤال طويل جداً (الحد الأقصى 1000 حرف)' });
      return;
    }

    // Validate mode
    const isAnalyze = mode === 'analyze';

    // Step 1: get Gemini client (throws MISSING_KEY if not configured)
    const model = getGemini();

    // Step 2: gather read-only data snapshot
    const snapshot = await withTimeout(gatherSnapshot(), TIMEOUT_MS);

    // Step 3: build minimal context
    const topics    = isAnalyze ? ['all'] : classifyQuestion(question);
    const context   = buildContext(snapshot, topics);
    const sysPrompt = isAnalyze ? ANALYSIS_PROMPT : SYSTEM_PROMPT;

    const prompt = `${sysPrompt}

البيانات المتاحة (${snapshot.date}):
${JSON.stringify(context, null, 2)}

${isAnalyze ? 'أنشئ التقرير الإداري الشامل الآن.' : `سؤال المستخدم: ${question}`}`;

    // Step 4: call Gemini with retry (503 / 429 / ETIMEDOUT → up to 3 attempts)
    const answer = await callGeminiWithRetry(model, prompt);

    res.json({ answer, topics_used: topics });

  } catch (err: unknown) {
    console.error('AI Assistant error:', err instanceof Error ? err.message : err);
    const { status, message } = toArabicError(err);
    res.status(status).json({ message });
  }
});

export default router;

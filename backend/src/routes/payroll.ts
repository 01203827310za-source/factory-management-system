// ============================================
// Payroll Routes  /api/payroll/*
// Resources: employees | production | advances
//            deductions | bonuses | salary | report
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';

const router = Router();
router.use(authenticate);

// ─── Shared include shapes ────────────────────
const EMP_INCLUDE = {
  piece_rates: { orderBy: { category_name: 'asc' as const } },
} as const;

const WITH_EMP = { employee: { include: EMP_INCLUDE } } as const;

// ─── Date helpers ─────────────────────────────
function monthRange(month: number, year: number) {
  const mm   = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${mm}-01`,
    to:   `${year}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

// ─── Sync piece rates helper ──────────────────
async function syncPieceRates(
  employeeId: number,
  rates: { category_name: string; piece_rate: number }[],
) {
  await prisma.employeePieceRate.deleteMany({ where: { employee_id: employeeId } });
  if (rates?.length) {
    await prisma.employeePieceRate.createMany({
      data: rates.map(r => ({
        employee_id:   employeeId,
        category_name: r.category_name,
        piece_rate:    r.piece_rate,
      })),
    });
  }
}

// ==============================================
// EMPLOYEES
// ==============================================

router.get('/employees', async (_req, res) => {
  try {
    return res.json(await prisma.employee.findMany({
      include: EMP_INCLUDE,
      orderBy: { employee_code: 'asc' },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب الموظفين' });
  }
});

router.post('/employees', requireManager, async (req, res) => {
  const { piece_rates, ...empData } = req.body;
  try {
    const emp = await prisma.employee.create({ data: empData });
    if (emp.employee_type === 'piecework' && piece_rates?.length) {
      await syncPieceRates(emp.id, piece_rates);
    }
    const fresh = await prisma.employee.findUnique({ where: { id: emp.id }, include: EMP_INCLUDE });
    logAudit({ user: req.user, module: 'Payroll-Employees', action: 'CREATE', record_id: emp.id,
      after_data: fresh, description: `إضافة موظف: ${emp.employee_name}` });
    return res.status(201).json(fresh);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unique constraint')) return res.status(400).json({ message: 'كود الموظف مستخدم بالفعل' });
    return res.status(500).json({ message: 'خطأ في إضافة الموظف' });
  }
});

router.put('/employees/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const { piece_rates, ...empData } = req.body;
  try {
    const before = await prisma.employee.findUnique({ where: { id }, include: EMP_INCLUDE });
    const emp    = await prisma.employee.update({ where: { id }, data: empData });
    await syncPieceRates(id, emp.employee_type === 'piecework' ? (piece_rates ?? []) : []);
    const fresh = await prisma.employee.findUnique({ where: { id }, include: EMP_INCLUDE });
    logAudit({ user: req.user, module: 'Payroll-Employees', action: 'UPDATE', record_id: id,
      before_data: before, after_data: fresh, description: `تعديل موظف: ${emp.employee_name}` });
    return res.json(fresh);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل الموظف' });
  }
});

router.delete('/employees/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employee.findUnique({ where: { id }, include: EMP_INCLUDE });
    await prisma.employee.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Employees', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف موظف: ${before?.employee_name}` });
    return res.json({ message: 'تم حذف الموظف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف الموظف' });
  }
});

// ==============================================
// PRODUCTION
// ==============================================

router.get('/production', async (req, res) => {
  try {
    const { month, year, employee_id } = req.query;
    const where: Record<string, unknown> = {};
    if (month && year) {
      const { from, to } = monthRange(parseInt(month as string), parseInt(year as string));
      where.date = { gte: from, lte: to };
    }
    if (employee_id) where.employee_id = parseInt(employee_id as string);
    return res.json(await prisma.employeeProduction.findMany({
      where, include: WITH_EMP, orderBy: { date: 'desc' },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب الإنتاج' });
  }
});

router.post('/production', requireManager, async (req, res) => {
  try {
    const { employee_id, category_name, piece_rate, quantity, date, notes } = req.body;
    const production_value = (quantity ?? 0) * (piece_rate ?? 0);
    const rec = await prisma.employeeProduction.create({
      data: { employee_id, category_name, piece_rate, quantity, production_value, date, notes: notes ?? '' },
      include: WITH_EMP,
    });
    logAudit({ user: req.user, module: 'Payroll-Production', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `إضافة إنتاج: ${rec.employee.employee_name} - ${category_name}` });
    return res.status(201).json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في إضافة الإنتاج' });
  }
});

router.put('/production/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeProduction.findUnique({ where: { id }, include: WITH_EMP });
    const { employee_id, category_name, piece_rate, quantity, date, notes } = req.body;
    const production_value = (quantity ?? 0) * (piece_rate ?? 0);
    const rec = await prisma.employeeProduction.update({
      where: { id },
      data: { employee_id, category_name, piece_rate, quantity, production_value, date, notes },
      include: WITH_EMP,
    });
    logAudit({ user: req.user, module: 'Payroll-Production', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل إنتاج: ${rec.employee.employee_name}` });
    return res.json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل الإنتاج' });
  }
});

router.delete('/production/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeProduction.findUnique({ where: { id }, include: WITH_EMP });
    await prisma.employeeProduction.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Production', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف إنتاج: ${before?.employee?.employee_name}` });
    return res.json({ message: 'تم الحذف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في الحذف' });
  }
});

// ==============================================
// ADVANCES
// ==============================================

router.get('/advances', async (req, res) => {
  try {
    const { month, year, employee_id } = req.query;
    const where: Record<string, unknown> = {};
    if (month && year) {
      const { from, to } = monthRange(parseInt(month as string), parseInt(year as string));
      where.date = { gte: from, lte: to };
    }
    if (employee_id) where.employee_id = parseInt(employee_id as string);
    return res.json(await prisma.employeeAdvance.findMany({
      where, include: WITH_EMP, orderBy: { date: 'desc' },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب السلف' });
  }
});

router.post('/advances', requireManager, async (req, res) => {
  try {
    const rec = await prisma.employeeAdvance.create({ data: req.body, include: WITH_EMP });
    logAudit({ user: req.user, module: 'Payroll-Advances', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `سلفة: ${rec.employee.employee_name} - ${rec.amount}` });
    return res.status(201).json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في إضافة السلفة' });
  }
});

router.put('/advances/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeAdvance.findUnique({ where: { id }, include: WITH_EMP });
    const rec    = await prisma.employeeAdvance.update({ where: { id }, data: req.body, include: WITH_EMP });
    logAudit({ user: req.user, module: 'Payroll-Advances', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل سلفة: ${rec.employee.employee_name}` });
    return res.json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل السلفة' });
  }
});

router.delete('/advances/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeAdvance.findUnique({ where: { id }, include: WITH_EMP });
    await prisma.employeeAdvance.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Advances', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف سلفة: ${before?.employee?.employee_name}` });
    return res.json({ message: 'تم الحذف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في الحذف' });
  }
});

// ==============================================
// DEDUCTIONS
// ==============================================

router.get('/deductions', async (req, res) => {
  try {
    const { month, year, employee_id } = req.query;
    const where: Record<string, unknown> = {};
    if (month && year) {
      const { from, to } = monthRange(parseInt(month as string), parseInt(year as string));
      where.date = { gte: from, lte: to };
    }
    if (employee_id) where.employee_id = parseInt(employee_id as string);
    return res.json(await prisma.employeeDeduction.findMany({
      where, include: WITH_EMP, orderBy: { date: 'desc' },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب الخصومات' });
  }
});

router.post('/deductions', requireManager, async (req, res) => {
  try {
    const rec = await prisma.employeeDeduction.create({ data: req.body, include: WITH_EMP });
    logAudit({ user: req.user, module: 'Payroll-Deductions', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `خصم: ${rec.employee.employee_name} - ${rec.amount}` });
    return res.status(201).json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في إضافة الخصم' });
  }
});

router.put('/deductions/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeDeduction.findUnique({ where: { id }, include: WITH_EMP });
    const rec    = await prisma.employeeDeduction.update({ where: { id }, data: req.body, include: WITH_EMP });
    logAudit({ user: req.user, module: 'Payroll-Deductions', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل خصم: ${rec.employee.employee_name}` });
    return res.json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل الخصم' });
  }
});

router.delete('/deductions/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeDeduction.findUnique({ where: { id }, include: WITH_EMP });
    await prisma.employeeDeduction.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Deductions', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف خصم: ${before?.employee?.employee_name}` });
    return res.json({ message: 'تم الحذف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في الحذف' });
  }
});

// ==============================================
// BONUSES
// ==============================================

router.get('/bonuses', async (req, res) => {
  try {
    const { month, year, employee_id } = req.query;
    const where: Record<string, unknown> = {};
    if (month && year) {
      const { from, to } = monthRange(parseInt(month as string), parseInt(year as string));
      where.date = { gte: from, lte: to };
    }
    if (employee_id) where.employee_id = parseInt(employee_id as string);
    return res.json(await prisma.employeeBonus.findMany({
      where, include: WITH_EMP, orderBy: { date: 'desc' },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب المكافآت' });
  }
});

router.post('/bonuses', requireManager, async (req, res) => {
  try {
    const rec = await prisma.employeeBonus.create({ data: req.body, include: WITH_EMP });
    logAudit({ user: req.user, module: 'Payroll-Bonuses', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `مكافأة: ${rec.employee.employee_name} - ${rec.amount}` });
    return res.status(201).json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في إضافة المكافأة' });
  }
});

router.put('/bonuses/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeBonus.findUnique({ where: { id }, include: WITH_EMP });
    const rec    = await prisma.employeeBonus.update({ where: { id }, data: req.body, include: WITH_EMP });
    logAudit({ user: req.user, module: 'Payroll-Bonuses', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل مكافأة: ${rec.employee.employee_name}` });
    return res.json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل المكافأة' });
  }
});

router.delete('/bonuses/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employeeBonus.findUnique({ where: { id }, include: WITH_EMP });
    await prisma.employeeBonus.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Bonuses', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف مكافأة: ${before?.employee?.employee_name}` });
    return res.json({ message: 'تم الحذف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في الحذف' });
  }
});

// ==============================================
// SALARY — dynamic calculation for month/year
// ==============================================

router.get('/salary', async (req, res) => {
  try {
    const month = parseInt(req.query.month as string);
    const year  = parseInt(req.query.year  as string);
    if (!month || !year) return res.status(400).json({ message: 'الشهر والسنة مطلوبان' });

    const { from, to } = monthRange(month, year);

    const [employees, productions, advances, deductions, bonuses] = await Promise.all([
      prisma.employee.findMany({ include: EMP_INCLUDE, orderBy: { employee_code: 'asc' } }),
      prisma.employeeProduction.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
      prisma.employeeAdvance.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.employeeDeduction.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.employeeBonus.findMany({ where: { date: { gte: from, lte: to } } }),
    ]);

    const prodByEmp: Record<number, typeof productions> = {};
    productions.forEach(p => { (prodByEmp[p.employee_id] ??= []).push(p); });

    const sumByEmp = <T extends { employee_id: number; amount: number }>(arr: T[]) => {
      const m: Record<number, number> = {};
      arr.forEach(r => { m[r.employee_id] = (m[r.employee_id] ?? 0) + r.amount; });
      return m;
    };
    const advMap = sumByEmp(advances);
    const dedMap = sumByEmp(deductions);
    const bonMap = sumByEmp(bonuses);

    const rows = employees.map(emp => {
      const empProds         = prodByEmp[emp.id] ?? [];
      const production_value = empProds.reduce((s, p) => s + p.production_value, 0);
      const total_advances   = advMap[emp.id] ?? 0;
      const total_deductions = dedMap[emp.id] ?? 0;
      const total_bonuses    = bonMap[emp.id] ?? 0;
      const base             = emp.employee_type === 'fixed' ? emp.base_salary : production_value;
      const net_salary       = base + total_bonuses - total_advances - total_deductions;
      return { employee: emp, production_value, total_advances, total_deductions, total_bonuses, net_salary, productions: empProds };
    });

    return res.json(rows);
  } catch {
    return res.status(500).json({ message: 'خطأ في حساب المرتبات' });
  }
});

// ==============================================
// REPORT — summary for month/year
// ==============================================

router.get('/report', async (req, res) => {
  try {
    const month = parseInt(req.query.month as string);
    const year  = parseInt(req.query.year  as string);
    if (!month || !year) return res.status(400).json({ message: 'الشهر والسنة مطلوبان' });

    const { from, to } = monthRange(month, year);

    const [employees, productions, advances, deductions, bonuses] = await Promise.all([
      prisma.employee.findMany({ include: EMP_INCLUDE, orderBy: { employee_code: 'asc' } }),
      prisma.employeeProduction.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.employeeAdvance.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.employeeDeduction.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.employeeBonus.findMany({ where: { date: { gte: from, lte: to } } }),
    ]);

    const prodByEmp: Record<number, number> = {};
    productions.forEach(p => { prodByEmp[p.employee_id] = (prodByEmp[p.employee_id] ?? 0) + p.production_value; });

    const sumByEmp = <T extends { employee_id: number; amount: number }>(arr: T[]) => {
      const m: Record<number, number> = {};
      arr.forEach(r => { m[r.employee_id] = (m[r.employee_id] ?? 0) + r.amount; });
      return m;
    };
    const advMap = sumByEmp(advances);
    const dedMap = sumByEmp(deductions);
    const bonMap = sumByEmp(bonuses);

    let total_fixed_salaries     = 0;
    let total_piecework_salaries = 0;
    const total_advances         = advances.reduce((s, a) => s + a.amount, 0);
    const total_deductions       = deductions.reduce((s, d) => s + d.amount, 0);
    const total_bonuses          = bonuses.reduce((s, b) => s + b.amount, 0);

    const rows = employees.map(emp => {
      const pv  = prodByEmp[emp.id] ?? 0;
      const adv = advMap[emp.id] ?? 0;
      const ded = dedMap[emp.id] ?? 0;
      const bon = bonMap[emp.id] ?? 0;
      const base = emp.employee_type === 'fixed' ? emp.base_salary : pv;
      const net  = base + bon - adv - ded;
      if (emp.employee_type === 'fixed') total_fixed_salaries    += net;
      else                               total_piecework_salaries += net;
      return { employee: emp, production_value: pv, total_advances: adv, total_deductions: ded, total_bonuses: bon, net_salary: net };
    });

    return res.json({
      month, year,
      total_employees:           employees.length,
      total_fixed_employees:     employees.filter(e => e.employee_type === 'fixed').length,
      total_piecework_employees: employees.filter(e => e.employee_type === 'piecework').length,
      total_fixed_salaries,
      total_piecework_salaries,
      total_advances,
      total_deductions,
      total_bonuses,
      total_payroll_cost: total_fixed_salaries + total_piecework_salaries,
      rows,
    });
  } catch {
    return res.status(500).json({ message: 'خطأ في تقرير المرتبات' });
  }
});

export default router;

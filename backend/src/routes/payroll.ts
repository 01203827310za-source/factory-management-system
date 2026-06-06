// ============================================
// Payroll Routes
// /api/payroll/employees  — Employee master data
// /api/payroll            — Monthly payroll records
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';

const router = Router();
router.use(authenticate);

// ─────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────

router.get('/employees', async (_req, res) => {
  try {
    const employees = await prisma.employee.findMany({ orderBy: { id: 'asc' } });
    return res.json(employees);
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب بيانات الموظفين' });
  }
});

router.post('/employees', requireManager, async (req, res) => {
  try {
    const employee = await prisma.employee.create({ data: req.body });
    logAudit({
      user: req.user,
      module: 'Payroll',
      action: 'CREATE',
      record_id: employee.id,
      after_data: employee,
      description: `إضافة موظف: ${employee.employee_name}`,
    });
    return res.status(201).json(employee);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unique constraint')) {
      return res.status(400).json({ message: 'كود الموظف مستخدم بالفعل' });
    }
    return res.status(500).json({ message: 'خطأ في إضافة الموظف' });
  }
});

router.put('/employees/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employee.findUnique({ where: { id } });
    const employee = await prisma.employee.update({ where: { id }, data: req.body });
    logAudit({
      user: req.user,
      module: 'Payroll',
      action: 'UPDATE',
      record_id: id,
      before_data: before,
      after_data: employee,
      description: `تعديل موظف: ${employee.employee_name}`,
    });
    return res.json(employee);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل الموظف' });
  }
});

router.delete('/employees/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employee.findUnique({ where: { id } });
    await prisma.employee.delete({ where: { id } });
    logAudit({
      user: req.user,
      module: 'Payroll',
      action: 'DELETE',
      record_id: id,
      before_data: before,
      description: `حذف موظف: ${before?.employee_name}`,
    });
    return res.json({ message: 'تم حذف الموظف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف الموظف' });
  }
});

// ─────────────────────────────────────────────
// PAYROLL RECORDS
// ─────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { month, year, employee_id } = req.query;
    const where: Record<string, unknown> = {};
    if (month)       where.month       = parseInt(month as string);
    if (year)        where.year        = parseInt(year  as string);
    if (employee_id) where.employee_id = parseInt(employee_id as string);

    const records = await prisma.payrollRecord.findMany({
      where,
      include: { employee: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { employee_id: 'asc' }],
    });
    return res.json(records);
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب كشف الرواتب' });
  }
});

// Generate monthly payroll — creates records for all active employees for a month/year.
// Skips employees that already have a record for that month (idempotent per employee).
router.post('/generate', requireManager, async (req, res) => {
  const { month, year } = req.body as { month: number; year: number };
  if (!month || !year) {
    return res.status(400).json({ message: 'الشهر والسنة مطلوبان' });
  }
  try {
    const employees = await prisma.employee.findMany({ where: { status: 'active' } });
    const created: unknown[] = [];

    for (const emp of employees) {
      const exists = await prisma.payrollRecord.findUnique({
        where: { employee_id_month_year: { employee_id: emp.id, month, year } },
      });
      if (exists) continue;

      const record = await prisma.payrollRecord.create({
        data: {
          employee_id:   emp.id,
          employee_type: emp.employee_type,
          month,
          year,
          net_salary: emp.employee_type === 'fixed' ? emp.base_salary : 0,
        },
        include: { employee: true },
      });
      logAudit({
        user: req.user,
        module: 'Payroll',
        action: 'CREATE',
        record_id: record.id,
        after_data: record,
        description: `توليد راتب ${month}/${year}: ${emp.employee_name}`,
      });
      created.push(record);
    }
    return res.status(201).json({ generated: created.length, records: created });
  } catch {
    return res.status(500).json({ message: 'خطأ في توليد كشف الرواتب' });
  }
});

router.put('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.payrollRecord.findUnique({ where: { id }, include: { employee: true } });
    const record  = await prisma.payrollRecord.update({ where: { id }, data: req.body, include: { employee: true } });
    logAudit({
      user: req.user,
      module: 'Payroll',
      action: 'UPDATE',
      record_id: id,
      before_data: before,
      after_data: record,
      description: `تعديل راتب: ${record.employee.employee_name} ${record.month}/${record.year}`,
    });
    return res.json(record);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل سجل الراتب' });
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.payrollRecord.findUnique({ where: { id }, include: { employee: true } });
    await prisma.payrollRecord.delete({ where: { id } });
    logAudit({
      user: req.user,
      module: 'Payroll',
      action: 'DELETE',
      record_id: id,
      before_data: before,
      description: `حذف سجل راتب: ${before?.employee?.employee_name}`,
    });
    return res.json({ message: 'تم حذف سجل الراتب' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف سجل الراتب' });
  }
});

// Summary report for a given month/year
router.get('/report', async (req, res) => {
  try {
    const { month, year } = req.query;
    const where: Record<string, unknown> = {};
    if (month) where.month = parseInt(month as string);
    if (year)  where.year  = parseInt(year  as string);

    const records = await prisma.payrollRecord.findMany({ where, include: { employee: true } });

    const total_salaries   = records.reduce((s: number, r) => s + r.net_salary,                               0);
    const total_advances   = records.reduce((s: number, r) => s + r.advances,                                 0);
    const total_deductions = records.reduce((s: number, r) => s + r.absence_deduction + r.additional_deductions, 0);
    const total_bonuses    = records.reduce((s: number, r) => s + r.bonus + r.production_bonus,               0);
    const net_payroll      = total_salaries;

    return res.json({ total_salaries, total_advances, total_deductions, total_bonuses, net_payroll, records });
  } catch {
    return res.status(500).json({ message: 'خطأ في تقرير الرواتب' });
  }
});

export default router;

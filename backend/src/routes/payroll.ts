// ============================================
// Attendance & Payroll Routes  /api/payroll/*
// Resources: employees | attendance | adjustments | payroll
// ============================================

import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate, requireManager } from '../middleware/auth';
import { logAudit } from '../services/auditHelper';
import { calcEmployeePayroll, computeWorkedOvertime, daysInMonth } from '../services/payrollCalc';

const router = Router();
router.use(authenticate);

const WITH_EMP = { employee: true } as const;

const ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'vacation', 'business_trip'];
const ADJUSTMENT_TYPES    = ['advance', 'deduction', 'bonus'];

// ─── Date helpers ─────────────────────────────
function monthRange(month: number, year: number) {
  const mm   = String(month).padStart(2, '0');
  const last = daysInMonth(year, month);
  return {
    from: `${year}-${mm}-01`,
    to:   `${year}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

// ==============================================
// EMPLOYEES
// ==============================================

router.get('/employees', async (_req, res) => {
  try {
    return res.json(await prisma.employee.findMany({ orderBy: { name: 'asc' } }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب الموظفين' });
  }
});

router.post('/employees', requireManager, async (req, res) => {
  try {
    const { name, phone, job_title, monthly_salary, daily_hours, status } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'اسم الموظف مطلوب' });

    const emp = await prisma.employee.create({
      data: {
        name: String(name).trim(),
        phone: phone ?? '',
        job_title: job_title ?? '',
        monthly_salary: Number(monthly_salary) || 0,
        daily_hours: daily_hours != null && daily_hours !== '' ? Number(daily_hours) : 8,
        status: status === 'inactive' ? 'inactive' : 'active',
      },
    });
    logAudit({ user: req.user, module: 'Payroll-Employees', action: 'CREATE', record_id: emp.id,
      after_data: emp, description: `إضافة موظف: ${emp.name}` });
    return res.status(201).json(emp);
  } catch {
    return res.status(500).json({ message: 'خطأ في إضافة الموظف' });
  }
});

router.put('/employees/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employee.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ message: 'الموظف غير موجود' });

    const { name, phone, job_title, monthly_salary, daily_hours, status } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'اسم الموظف مطلوب' });

    const emp = await prisma.employee.update({
      where: { id },
      data: {
        name: String(name).trim(),
        phone: phone ?? '',
        job_title: job_title ?? '',
        monthly_salary: Number(monthly_salary) || 0,
        daily_hours: daily_hours != null && daily_hours !== '' ? Number(daily_hours) : 8,
        status: status === 'inactive' ? 'inactive' : 'active',
      },
    });
    logAudit({ user: req.user, module: 'Payroll-Employees', action: 'UPDATE', record_id: id,
      before_data: before, after_data: emp, description: `تعديل موظف: ${emp.name}` });
    return res.json(emp);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل الموظف' });
  }
});

router.delete('/employees/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.employee.findUnique({ where: { id } });
    if (!before) return res.status(404).json({ message: 'الموظف غير موجود' });
    await prisma.employee.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Employees', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف موظف: ${before.name}` });
    return res.json({ message: 'تم حذف الموظف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في حذف الموظف' });
  }
});

// ==============================================
// ATTENDANCE
// ==============================================

router.get('/attendance', async (req, res) => {
  try {
    const { month, year, employee_id, date } = req.query;
    const where: Record<string, unknown> = {};
    if (month && year) {
      const { from, to } = monthRange(parseInt(month as string), parseInt(year as string));
      where.date = { gte: from, lte: to };
    }
    if (date) where.date = date as string;
    if (employee_id) where.employee_id = parseInt(employee_id as string);
    return res.json(await prisma.attendance.findMany({
      where, include: WITH_EMP, orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب الحضور والانصراف' });
  }
});

router.post('/attendance', requireManager, async (req, res) => {
  try {
    const { employee_id, date, check_in, check_out, status, notes } = req.body;
    if (!employee_id || !date) return res.status(400).json({ message: 'الموظف والتاريخ مطلوبان' });
    const st = ATTENDANCE_STATUSES.includes(status) ? status : 'present';

    const employee = await prisma.employee.findUnique({ where: { id: Number(employee_id) } });
    if (!employee) return res.status(404).json({ message: 'الموظف غير موجود' });

    if (st !== 'absent' && (!!check_in !== !!check_out)) {
      return res.status(400).json({ message: 'يجب إدخال وقت الحضور والانصراف معاً' });
    }

    const isAbsent = st === 'absent';
    const { worked_hours, overtime_hours } = computeWorkedOvertime(st, check_in, check_out, employee.daily_hours);

    const rec = await prisma.attendance.create({
      data: {
        employee_id: Number(employee_id),
        date,
        check_in: isAbsent ? '' : (check_in ?? ''),
        check_out: isAbsent ? '' : (check_out ?? ''),
        worked_hours,
        overtime_hours,
        status: st,
        notes: notes ?? '',
      },
      include: WITH_EMP,
    });
    logAudit({ user: req.user, module: 'Payroll-Attendance', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `تسجيل حضور: ${rec.employee.name} - ${date}` });
    return res.status(201).json(rec);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unique constraint')) return res.status(400).json({ message: 'يوجد سجل حضور لهذا الموظف في نفس التاريخ' });
    return res.status(500).json({ message: 'خطأ في إضافة سجل الحضور' });
  }
});

router.put('/attendance/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.attendance.findUnique({ where: { id }, include: WITH_EMP });
    if (!before) return res.status(404).json({ message: 'السجل غير موجود' });

    const { employee_id, date, check_in, check_out, status, notes } = req.body;
    const st = ATTENDANCE_STATUSES.includes(status) ? status : before.status;
    const empId = employee_id ? Number(employee_id) : before.employee_id;

    const employee = await prisma.employee.findUnique({ where: { id: empId } });
    if (!employee) return res.status(404).json({ message: 'الموظف غير موجود' });

    if (st !== 'absent' && (!!check_in !== !!check_out)) {
      return res.status(400).json({ message: 'يجب إدخال وقت الحضور والانصراف معاً' });
    }

    const isAbsent = st === 'absent';
    const { worked_hours, overtime_hours } = computeWorkedOvertime(st, check_in, check_out, employee.daily_hours);

    const rec = await prisma.attendance.update({
      where: { id },
      data: {
        employee_id: empId,
        date: date ?? before.date,
        check_in: isAbsent ? '' : (check_in ?? ''),
        check_out: isAbsent ? '' : (check_out ?? ''),
        worked_hours,
        overtime_hours,
        status: st,
        notes: notes ?? before.notes,
      },
      include: WITH_EMP,
    });
    logAudit({ user: req.user, module: 'Payroll-Attendance', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل حضور: ${rec.employee.name} - ${rec.date}` });
    return res.json(rec);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('Unique constraint')) return res.status(400).json({ message: 'يوجد سجل حضور لهذا الموظف في نفس التاريخ' });
    return res.status(500).json({ message: 'خطأ في تعديل سجل الحضور' });
  }
});

router.delete('/attendance/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.attendance.findUnique({ where: { id }, include: WITH_EMP });
    if (!before) return res.status(404).json({ message: 'السجل غير موجود' });
    await prisma.attendance.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Attendance', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف حضور: ${before.employee.name} - ${before.date}` });
    return res.json({ message: 'تم الحذف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في الحذف' });
  }
});

// ==============================================
// SALARY ADJUSTMENTS (advances / deductions / bonuses)
// ==============================================

router.get('/adjustments', async (req, res) => {
  try {
    const { month, year, employee_id, type } = req.query;
    const where: Record<string, unknown> = {};
    if (month && year) {
      const { from, to } = monthRange(parseInt(month as string), parseInt(year as string));
      where.date = { gte: from, lte: to };
    }
    if (employee_id) where.employee_id = parseInt(employee_id as string);
    if (type && ADJUSTMENT_TYPES.includes(type as string)) where.type = type as string;
    return res.json(await prisma.salaryAdjustment.findMany({
      where, include: WITH_EMP, orderBy: { date: 'desc' },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب السلف والخصومات' });
  }
});

router.post('/adjustments', requireManager, async (req, res) => {
  try {
    const { employee_id, date, type, amount, reason } = req.body;
    if (!employee_id || !date) return res.status(400).json({ message: 'الموظف والتاريخ مطلوبان' });
    if (!ADJUSTMENT_TYPES.includes(type)) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });
    if (!(Number(amount) > 0)) return res.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });

    const rec = await prisma.salaryAdjustment.create({
      data: { employee_id: Number(employee_id), date, type, amount: Number(amount), reason: reason ?? '' },
      include: WITH_EMP,
    });
    logAudit({ user: req.user, module: 'Payroll-Adjustments', action: 'CREATE', record_id: rec.id,
      after_data: rec, description: `${rec.type}: ${rec.employee.name} - ${rec.amount}` });
    return res.status(201).json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في إضافة الحركة' });
  }
});

router.put('/adjustments/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.salaryAdjustment.findUnique({ where: { id }, include: WITH_EMP });
    if (!before) return res.status(404).json({ message: 'السجل غير موجود' });

    const { employee_id, date, type, amount, reason } = req.body;
    if (type && !ADJUSTMENT_TYPES.includes(type)) return res.status(400).json({ message: 'نوع الحركة غير صحيح' });
    if (amount != null && !(Number(amount) > 0)) return res.status(400).json({ message: 'المبلغ يجب أن يكون أكبر من صفر' });

    const rec = await prisma.salaryAdjustment.update({
      where: { id },
      data: {
        employee_id: employee_id ? Number(employee_id) : before.employee_id,
        date: date ?? before.date,
        type: type ?? before.type,
        amount: amount != null ? Number(amount) : before.amount,
        reason: reason ?? before.reason,
      },
      include: WITH_EMP,
    });
    logAudit({ user: req.user, module: 'Payroll-Adjustments', action: 'UPDATE', record_id: id,
      before_data: before, after_data: rec, description: `تعديل حركة: ${rec.employee.name}` });
    return res.json(rec);
  } catch {
    return res.status(500).json({ message: 'خطأ في تعديل الحركة' });
  }
});

router.delete('/adjustments/:id', requireManager, async (req, res) => {
  const id = parseInt(req.params.id as string);
  try {
    const before = await prisma.salaryAdjustment.findUnique({ where: { id }, include: WITH_EMP });
    if (!before) return res.status(404).json({ message: 'السجل غير موجود' });
    await prisma.salaryAdjustment.delete({ where: { id } });
    logAudit({ user: req.user, module: 'Payroll-Adjustments', action: 'DELETE', record_id: id,
      before_data: before, description: `حذف حركة: ${before.employee.name}` });
    return res.json({ message: 'تم الحذف' });
  } catch {
    return res.status(500).json({ message: 'خطأ في الحذف' });
  }
});

// ==============================================
// PAYROLL — automatic generation, no manual entry
// ==============================================

router.get('/records', async (req, res) => {
  try {
    const month = parseInt(req.query.month as string);
    const year  = parseInt(req.query.year as string);
    if (!month || !year) return res.status(400).json({ message: 'الشهر والسنة مطلوبان' });

    return res.json(await prisma.payroll.findMany({
      where: { month, year },
      include: WITH_EMP,
      orderBy: { employee: { name: 'asc' } },
    }));
  } catch {
    return res.status(500).json({ message: 'خطأ في جلب كشف المرتبات' });
  }
});

router.post('/generate', requireManager, async (req, res) => {
  try {
    const month = parseInt(req.body.month);
    const year  = parseInt(req.body.year);
    if (!month || !year || month < 1 || month > 12) {
      return res.status(400).json({ message: 'الشهر والسنة مطلوبان' });
    }

    const { from, to } = monthRange(month, year);
    const [employees, attendance, adjustments] = await Promise.all([
      prisma.employee.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' } }),
      prisma.attendance.findMany({ where: { date: { gte: from, lte: to } } }),
      prisma.salaryAdjustment.findMany({ where: { date: { gte: from, lte: to } } }),
    ]);

    const results = [];
    for (const emp of employees) {
      const empAttendance  = attendance.filter(a => a.employee_id === emp.id);
      const empAdjustments = adjustments.filter(a => a.employee_id === emp.id);
      const calc = calcEmployeePayroll(emp, month, year, empAttendance, empAdjustments);

      const row = await prisma.payroll.upsert({
        where: { employee_id_month_year: { employee_id: emp.id, month, year } },
        update: calc,
        create: { employee_id: emp.id, month, year, ...calc },
        include: WITH_EMP,
      });
      results.push(row);
    }

    logAudit({ user: req.user, module: 'Payroll-Generate', action: 'CREATE', record_id: `${month}-${year}`,
      after_data: { month, year, count: results.length }, description: `توليد مرتبات ${month}/${year} لعدد ${results.length} موظف` });

    return res.json(results);
  } catch {
    return res.status(500).json({ message: 'خطأ في توليد المرتبات' });
  }
});

export default router;

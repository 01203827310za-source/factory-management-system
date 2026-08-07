// ============================================
// Payroll Calculation Helpers — shared by the
// payroll routes and the AI assistant snapshot
// ============================================

export type EmployeeLite = {
  id: number;
  monthly_salary: number;
  daily_hours: number;
};

export type AttendanceLite = {
  employee_id: number;
  date: string;
  status: string;
  worked_hours: number;
  overtime_hours: number;
};

export type AdjustmentLite = {
  employee_id: number;
  type: string;
  amount: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// ─── Time parsing / validation ────────────────────────────────────────────────
function parseTimeToMinutes(t: string): number | null {
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Returns an Arabic error message if the times are invalid, otherwise null.
export function validateAttendanceTimes(
  check_in: string | null | undefined,
  check_out: string | null | undefined,
): string | null {
  if (!check_in || !check_out) return null;
  const inMin  = parseTimeToMinutes(check_in);
  const outMin = parseTimeToMinutes(check_out);
  if (inMin == null || outMin == null) return 'صيغة الوقت غير صحيحة';
  if (outMin < inMin) return 'وقت الانصراف لا يمكن أن يكون قبل وقت الحضور';
  return null;
}

// ─── Worked / overtime hours from check-in & check-out ───────────────────────
// `overtimeOverride`: when a manager manually edits the overtime field, pass
// the value here and it wins over the automatic (worked - daily hours) calc.
// Callers must validate the times with validateAttendanceTimes() first.
export function computeWorkedOvertime(
  status: string,
  check_in: string | null | undefined,
  check_out: string | null | undefined,
  dailyHours: number,
  overtimeOverride?: number | null,
) {
  if (status === 'absent' || !check_in || !check_out) {
    const overtime_hours = overtimeOverride != null ? round2(Math.max(0, overtimeOverride)) : 0;
    return { worked_hours: 0, overtime_hours };
  }

  const inMin  = parseTimeToMinutes(check_in);
  const outMin = parseTimeToMinutes(check_out);
  if (inMin == null || outMin == null || outMin < inMin) {
    const overtime_hours = overtimeOverride != null ? round2(Math.max(0, overtimeOverride)) : 0;
    return { worked_hours: 0, overtime_hours };
  }

  const worked = round2((outMin - inMin) / 60);
  const overtime_hours = overtimeOverride != null
    ? round2(Math.max(0, overtimeOverride))
    : round2(Math.max(0, worked - dailyHours));
  return { worked_hours: worked, overtime_hours };
}

// ─── Full payroll calculation for one employee / one month ──────────────────
export function calcEmployeePayroll(
  employee: EmployeeLite,
  month: number,
  year: number,
  attendance: AttendanceLite[],
  adjustments: AdjustmentLite[],
) {
  const dim         = daysInMonth(year, month);
  const dailySalary = dim > 0 ? employee.monthly_salary / dim : 0;
  const hourlyRate  = employee.daily_hours > 0 ? dailySalary / employee.daily_hours : 0;

  let presentDays = 0, absentDays = 0, halfDays = 0, vacationDays = 0, businessTripDays = 0;
  let workedHours = 0, overtimeHours = 0;

  attendance.forEach(a => {
    workedHours   += a.worked_hours;
    overtimeHours += a.overtime_hours;
    switch (a.status) {
      case 'present':       presentDays++;      break;
      case 'absent':        absentDays++;       break;
      case 'half_day':      halfDays++;         break;
      case 'vacation':      vacationDays++;     break;
      case 'business_trip': businessTripDays++; break;
    }
  });

  // Vacation & business-trip days are fully paid; half days count as half a
  // working day; absent days earn nothing.
  const payableDays    = presentDays + businessTripDays + vacationDays + halfDays * 0.5;
  const attendance_days = presentDays + businessTripDays + vacationDays;
  const base_salary     = round2(dailySalary * payableDays);
  const overtime_amount = round2(hourlyRate * overtimeHours);

  let advances = 0, deductions = 0, bonuses = 0;
  adjustments.forEach(a => {
    if (a.type === 'advance')        advances   += a.amount;
    else if (a.type === 'deduction') deductions += a.amount;
    else if (a.type === 'bonus')     bonuses    += a.amount;
  });

  const net_salary = round2(base_salary + overtime_amount + bonuses - advances - deductions);

  return {
    attendance_days,
    absent_days:     absentDays,
    half_days:       halfDays,
    worked_hours:    round2(workedHours),
    overtime_hours:  round2(overtimeHours),
    overtime_amount,
    advances:        round2(advances),
    deductions:      round2(deductions),
    bonuses:         round2(bonuses),
    base_salary,
    net_salary,
  };
}

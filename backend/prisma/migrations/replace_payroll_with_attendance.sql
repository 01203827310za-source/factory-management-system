-- Migration: replace_payroll_with_attendance
-- Removes the old piecework/production payroll system and replaces it with
-- an Attendance & Payroll Management System (employees, attendance,
-- salary adjustments, generated monthly payroll).
-- Run this SQL against the database, then: npx prisma generate
--
-- WARNING: this drops all existing payroll data (employees, production,
-- advances, deductions, bonuses, payroll_records) — it cannot be undone.

-- ── Drop old payroll tables (children first) ────────────────────────────────
DROP TABLE IF EXISTS "payroll_records" CASCADE;
DROP TABLE IF EXISTS "employee_bonuses" CASCADE;
DROP TABLE IF EXISTS "employee_deductions" CASCADE;
DROP TABLE IF EXISTS "employee_advances" CASCADE;
DROP TABLE IF EXISTS "employee_productions" CASCADE;
DROP TABLE IF EXISTS "employee_piece_rates" CASCADE;
DROP TABLE IF EXISTS "employees" CASCADE;

-- ── EMPLOYEES ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "employees" (
  "id"             SERIAL           NOT NULL,
  "name"           TEXT             NOT NULL,
  "phone"          TEXT             NOT NULL DEFAULT '',
  "job_title"      TEXT             NOT NULL DEFAULT '',
  "monthly_salary" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "daily_hours"    DOUBLE PRECISION NOT NULL DEFAULT 8,
  "status"         TEXT             NOT NULL DEFAULT 'active',
  "created_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- ── ATTENDANCE ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "attendance" (
  "id"             SERIAL           NOT NULL,
  "employee_id"    INTEGER          NOT NULL,
  "date"           TEXT             NOT NULL,
  "check_in"       TEXT             NOT NULL DEFAULT '',
  "check_out"      TEXT             NOT NULL DEFAULT '',
  "worked_hours"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "overtime_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"         TEXT             NOT NULL DEFAULT 'present',
  "notes"          TEXT             NOT NULL DEFAULT '',
  "created_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_employee_id_date_key" ON "attendance"("employee_id", "date");

-- ── SALARY ADJUSTMENTS (advances / deductions / bonuses) ────────────────────
CREATE TABLE IF NOT EXISTS "salary_adjustments" (
  "id"          SERIAL           NOT NULL,
  "employee_id" INTEGER          NOT NULL,
  "date"        TEXT             NOT NULL,
  "type"        TEXT             NOT NULL,
  "amount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason"      TEXT             NOT NULL DEFAULT '',
  "created_at"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salary_adjustments_pkey" PRIMARY KEY ("id")
);

-- ── GENERATED MONTHLY PAYROLL ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payroll" (
  "id"              SERIAL           NOT NULL,
  "employee_id"     INTEGER          NOT NULL,
  "month"           INTEGER          NOT NULL,
  "year"            INTEGER          NOT NULL,
  "attendance_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "absent_days"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "half_days"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "worked_hours"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "overtime_hours"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "overtime_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "advances"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deductions"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bonuses"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "base_salary"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "net_salary"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "generated_at"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_employee_id_month_year_key" ON "payroll"("employee_id", "month", "year");

-- ── Foreign keys ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_employee_id_fkey') THEN
    ALTER TABLE "attendance"
      ADD CONSTRAINT "attendance_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salary_adjustments_employee_id_fkey') THEN
    ALTER TABLE "salary_adjustments"
      ADD CONSTRAINT "salary_adjustments_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employee_id_fkey') THEN
    ALTER TABLE "payroll"
      ADD CONSTRAINT "payroll_employee_id_fkey"
      FOREIGN KEY ("employee_id") REFERENCES "employees"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

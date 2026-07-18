-- ============================================================
-- Phase 1: Single-Owner Migration
-- Adds amount_in / amount_out to expenses_revenues.
-- Migrates existing data: amount_in = hatem_in + mido_in
--                         amount_out = hatem_out + mido_out
-- Old columns (hatem_in, hatem_out, mido_in, mido_out) are
-- kept intentionally — they will be dropped in Phase 2 only
-- after all code has been verified against the new columns.
-- ============================================================

-- 1. Add new single-owner columns
ALTER TABLE expenses_revenues
  ADD COLUMN IF NOT EXISTS amount_in  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_out DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2. Migrate historical data: combine both partners into one
UPDATE expenses_revenues
SET amount_in  = hatem_in  + mido_in,
    amount_out = hatem_out + mido_out;

-- 3. Drop ready_stock partner columns
ALTER TABLE ready_stock
  DROP COLUMN IF EXISTS mido_stock,
  DROP COLUMN IF EXISTS hatem_stock;

-- 4. Drop partners table (partner feature fully removed)
DROP TABLE IF EXISTS partners;

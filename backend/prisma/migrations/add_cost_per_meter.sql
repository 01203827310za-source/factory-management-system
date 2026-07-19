-- Migration: add_cost_per_meter
-- Adds cost_per_meter column to cutting_orders table.
-- Run this SQL against the database, then: npx prisma generate

ALTER TABLE "cutting_orders"
  ADD COLUMN IF NOT EXISTS "cost_per_meter" DOUBLE PRECISION NOT NULL DEFAULT 0;

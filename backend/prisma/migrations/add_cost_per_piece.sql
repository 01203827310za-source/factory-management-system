-- Migration: add_cost_per_piece
-- Adds cost_per_piece column to model_productions table.
-- Run this SQL against the database, then: npx prisma generate

ALTER TABLE "model_productions"
  ADD COLUMN IF NOT EXISTS "cost_per_piece" DOUBLE PRECISION NOT NULL DEFAULT 0;

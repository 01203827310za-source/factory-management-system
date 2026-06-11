-- Migration: add color to model_parts
-- Run this SQL against your database, then run: npx prisma generate
-- ---------------------------------------------------------------

-- Add color column to model_parts
ALTER TABLE "model_parts" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT '';

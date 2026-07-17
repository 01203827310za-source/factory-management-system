-- Migration: add_financial_snapshots
-- Run this SQL against your database, then run: npx prisma generate
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "financial_snapshots" (
  "id"                   SERIAL           NOT NULL,
  "snapshot_date"        VARCHAR(10)      NOT NULL,
  "total_current_assets" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cash"                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fabric_assets"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ready_stock_assets"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "accessories_assets"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivables"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "debts"                DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "financial_snapshots_snapshot_date_key"
  ON "financial_snapshots" ("snapshot_date");

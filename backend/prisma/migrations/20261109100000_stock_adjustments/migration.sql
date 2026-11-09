-- Physical inventory reconciliation — additive, non-destructive. No existing row is changed.
CREATE TABLE IF NOT EXISTS "stock_adjustments" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "stock_id" INTEGER NOT NULL,
  "model_code" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '',
  "previous_physical" INTEGER NOT NULL,
  "counted_physical" INTEGER NOT NULL,
  "difference" INTEGER NOT NULL,
  "reserved_at_time" INTEGER NOT NULL DEFAULT 0,
  "uncovered_reservations" INTEGER NOT NULL DEFAULT 0,
  "conflict_acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_adjustments_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "stock_adjustments_idempotency_key_key" ON "stock_adjustments"("idempotency_key");
CREATE INDEX IF NOT EXISTS "stock_adjustments_season_id_stock_id_idx" ON "stock_adjustments"("season_id", "stock_id");

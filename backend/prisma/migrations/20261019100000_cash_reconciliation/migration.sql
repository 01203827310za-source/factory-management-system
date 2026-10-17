-- Cash reconciliation — additive, non-destructive. No existing row is changed.
-- cash_counts: a physical cash count compared with the calculated balance (never edits history).
-- cash_adjustments: the opening balance and explicit, reasoned corrections (signed amount, user, unique idempotency key).

CREATE TABLE IF NOT EXISTS "cash_counts" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "count_date" TEXT NOT NULL,
  "counted_amount" DOUBLE PRECISION NOT NULL,
  "calculated_amount" DOUBLE PRECISION NOT NULL,
  "difference" DOUBLE PRECISION NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_counts_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "cash_counts_idempotency_key_key" ON "cash_counts"("idempotency_key");
CREATE INDEX IF NOT EXISTS "cash_counts_season_id_count_date_idx" ON "cash_counts"("season_id", "count_date");

CREATE TABLE IF NOT EXISTS "cash_adjustments" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "entry_date" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_adjustments_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "cash_adjustments_idempotency_key_key" ON "cash_adjustments"("idempotency_key");
CREATE INDEX IF NOT EXISTS "cash_adjustments_season_id_kind_idx" ON "cash_adjustments"("season_id", "kind");

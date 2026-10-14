-- Monthly charity (صدقة الشهر) — additive, non-destructive migration.
--
-- 1) sales.shipping_collected_date: the day the shipping company's payout was confirmed.
--    Nullable and NOT back-filled: orders dispatched before this column existed keep NULL
--    (their real receipt date is unknown and must not be invented).
-- 2) charity_payments: one row per charity payment, 1:1 with the expenses_revenues row
--    that records the same money movement.

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "shipping_collected_date" TEXT;

CREATE TABLE IF NOT EXISTS "charity_payments" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "charity_month" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "payment_date" TEXT NOT NULL,
  "payment_method" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "expense_id" INTEGER,
  "idempotency_key" TEXT NOT NULL,
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "charity_payments_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "charity_payments_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses_revenues"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "charity_payments_expense_id_key" ON "charity_payments"("expense_id");
CREATE UNIQUE INDEX IF NOT EXISTS "charity_payments_idempotency_key_key" ON "charity_payments"("idempotency_key");
CREATE INDEX IF NOT EXISTS "charity_payments_season_id_charity_month_idx" ON "charity_payments"("season_id", "charity_month");

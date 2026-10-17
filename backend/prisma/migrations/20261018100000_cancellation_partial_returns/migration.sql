-- Cancellation: partial returns + richer audit row. Additive and non-destructive.
--
-- sales.modelN_unreturned_qty (NULL by default): for a shipped order that is cancelled, how many pieces of line N
--   are still outside the sellable stock. NULL on every existing row, so every order cancelled before this
--   migration keeps exactly the behaviour it has today (nothing is re-derived or re-costed).
-- order_cancellations: extra audit columns (quantities restored, refunds paid in the same save, amounts reversed).

ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "model1_unreturned_qty" INTEGER,
  ADD COLUMN IF NOT EXISTS "model2_unreturned_qty" INTEGER,
  ADD COLUMN IF NOT EXISTS "model3_unreturned_qty" INTEGER,
  ADD COLUMN IF NOT EXISTS "model4_unreturned_qty" INTEGER,
  ADD COLUMN IF NOT EXISTS "model5_unreturned_qty" INTEGER;

ALTER TABLE "order_cancellations"
  ADD COLUMN IF NOT EXISTS "restored_qty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refund_customer_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "repaid_shipping" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "revenue_reversed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "receivable_reversed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "linked_invoice_ids" TEXT NOT NULL DEFAULT '[]';

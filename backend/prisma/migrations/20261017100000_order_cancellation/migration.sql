-- Full order cancellation — additive, non-destructive.
--
-- sales.cancel_disposition: for a SHIPPED order that is cancelled, what happened to the goods
--   (returned_resalable | not_returned | returned_damaged). NULL everywhere else, including every
--   order cancelled before this column existed (those keep their current behaviour).
-- order_cancellations: audit row per cancellation, linking the ledger rows that were reversed.
--
-- No existing row is changed.

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "cancel_disposition" TEXT;

CREATE TABLE IF NOT EXISTS "order_cancellations" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "sale_id" INTEGER NOT NULL,
  "status_before" TEXT NOT NULL,
  "was_shipped" BOOLEAN NOT NULL DEFAULT false,
  "disposition" TEXT,
  "reason" TEXT NOT NULL DEFAULT '',
  "goods_qty" INTEGER NOT NULL DEFAULT 0,
  "goods_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "deposit_held" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "collected_held" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "linked_collection_ids" TEXT NOT NULL DEFAULT '[]',
  "linked_movement_ids" TEXT NOT NULL DEFAULT '[]',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reopened_at" TIMESTAMP(3),
  CONSTRAINT "order_cancellations_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "order_cancellations_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "order_cancellations_sale_id_idx" ON "order_cancellations"("sale_id");
CREATE INDEX IF NOT EXISTS "order_cancellations_season_id_idx" ON "order_cancellations"("season_id");

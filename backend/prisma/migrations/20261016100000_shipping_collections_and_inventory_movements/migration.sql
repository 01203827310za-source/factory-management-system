-- Shipping-collection ledger + inventory-movement (cost) ledger.
-- Additive and non-destructive: no existing column or row is changed or removed.
--
-- shipping_collections: append-only signed ledger of cash received from the shipping company.
--   sales.shipping_collected stays as the maintained SUM of these rows, so every existing cash /
--   receivable formula is untouched.
-- inventory_movements: cost snapshot (unit_cost at the moment goods left) for cost of goods sold.

CREATE TABLE IF NOT EXISTS "shipping_collections" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "sale_id" INTEGER NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'collection',
  "collected_date" TEXT NOT NULL,
  "date_estimated" BOOLEAN NOT NULL DEFAULT false,
  "reference" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shipping_collections_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "shipping_collections_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "shipping_collections_sale_id_idx" ON "shipping_collections"("sale_id");
CREATE INDEX IF NOT EXISTS "shipping_collections_season_id_collected_date_idx" ON "shipping_collections"("season_id", "collected_date");

CREATE TABLE IF NOT EXISTS "inventory_movements" (
  "id" SERIAL PRIMARY KEY,
  "season_id" INTEGER NOT NULL,
  "sale_id" INTEGER NOT NULL,
  "stock_id" INTEGER,
  "movement_type" TEXT NOT NULL,
  "model_code" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '',
  "qty" INTEGER NOT NULL,
  "unit_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reference" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "inventory_movements_sale_id_idx" ON "inventory_movements"("sale_id");
CREATE INDEX IF NOT EXISTS "inventory_movements_season_id_idx" ON "inventory_movements"("season_id");

-- One-time opening balance: carry today's per-order shipping_collected into the ledger so
-- SUM(ledger) = shipping_collected for every dispatched order from day one. Idempotent
-- (skips orders that already have ledger rows). The receipt date is the stored payout date;
-- when that was never recorded the order's creation day is used and flagged as estimated.
-- NOTE: no historical inventory movements are fabricated — shipped orders from before this
-- migration simply have no recorded cost snapshot (reported as "uncosted" in the dashboard).
INSERT INTO "shipping_collections" ("season_id", "sale_id", "amount", "kind", "collected_date", "date_estimated", "reference", "created_by")
SELECT s."season_id", s."id", s."shipping_collected", 'opening',
       COALESCE(s."shipping_collected_date", to_char(s."created_at", 'YYYY-MM-DD')),
       (s."shipping_collected_date" IS NULL),
       'رصيد مرحّل من حقل المستلم السابق', 'migration'
FROM "sales" s
WHERE s."order_status" = 'تم الصرف'
  AND s."shipping_collected" <> 0
  AND NOT EXISTS (SELECT 1 FROM "shipping_collections" c WHERE c."sale_id" = s."id");

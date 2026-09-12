-- Add seasons without copying, deleting, or changing existing business data.
-- Existing operational rows are assigned to the initial Summer 2026 season.

CREATE TABLE IF NOT EXISTS "seasons" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "type" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "seasons_name_year_key" ON "seasons"("name", "year");
CREATE UNIQUE INDEX IF NOT EXISTS "one_active_season_key" ON "seasons"("is_active") WHERE "is_active" = true;

INSERT INTO "seasons" ("name", "year", "type", "status", "is_active")
VALUES ('Summer 2026', 2026, 'Summer', 'active', true)
ON CONFLICT ("name", "year") DO UPDATE SET
  "status" = 'active',
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;

WITH initial AS (SELECT "id" FROM "seasons" WHERE "name" = 'Summer 2026' AND "year" = 2026 LIMIT 1)
UPDATE "seasons" SET "is_active" = false, "status" = 'inactive'
WHERE "id" <> (SELECT "id" FROM initial) AND "is_active" = true;

DO $$
DECLARE
  initial_season_id INTEGER;
  table_name TEXT;
  tables TEXT[] := ARRAY[
    'sales',
    'expenses_revenues',
    'ready_stock',
    'fabric_warehouse',
    'fabric_purchases',
    'accessories_warehouse',
    'cutting_orders',
    'model_productions',
    'model_parts',
    'debts',
    'debt_payments',
    'client_accounts',
    'client_account_payments',
    'client_account_invoices',
    'return_items',
    'payment_logs',
    'financial_snapshots',
    'print_orders'
  ];
BEGIN
  SELECT "id" INTO initial_season_id FROM "seasons" WHERE "name" = 'Summer 2026' AND "year" = 2026 LIMIT 1;

  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "season_id" INTEGER', table_name);
    EXECUTE format('UPDATE %I SET "season_id" = $1 WHERE "season_id" IS NULL', table_name) USING initial_season_id;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "season_id" SET NOT NULL', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I("season_id")', table_name || '_season_id_idx', table_name);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
      table_name,
      table_name || '_season_id_fkey'
    );
  END LOOP;
END $$;

ALTER TABLE "financial_snapshots" DROP CONSTRAINT IF EXISTS "financial_snapshots_snapshot_date_key";
DROP INDEX IF EXISTS "financial_snapshots_snapshot_date_key";
CREATE UNIQUE INDEX IF NOT EXISTS "financial_snapshots_season_id_snapshot_date_key"
  ON "financial_snapshots"("season_id", "snapshot_date");

-- Safe, non-destructive season migration for existing production data.
-- Existing operational rows become part of Summer 2026.
-- This migration is intentionally explicit and does not use Prisma db push.

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

ALTER TABLE "seasons"
  ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "year" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "seasons_name_year_key"
  ON "seasons"("name", "year");

INSERT INTO "seasons" ("name", "year", "type", "status", "is_active")
VALUES ('Summer 2026', 2026, 'Summer', 'active', true)
ON CONFLICT ("name", "year") DO UPDATE SET
  "type" = CASE WHEN "seasons"."type" = '' THEN EXCLUDED."type" ELSE "seasons"."type" END,
  "status" = 'active',
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;

WITH initial AS (
  SELECT "id"
  FROM "seasons"
  WHERE "name" = 'Summer 2026' AND "year" = 2026
  LIMIT 1
)
UPDATE "seasons"
SET "is_active" = false, "status" = 'inactive'
WHERE "id" <> (SELECT "id" FROM initial)
  AND "is_active" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "one_active_season_key"
  ON "seasons"("is_active")
  WHERE "is_active" = true;

DO $$
DECLARE
  summer_season_id INTEGER;
  table_name TEXT;
  before_count BIGINT;
  after_count BIGINT;
  null_count BIGINT;
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
  SELECT "id"
  INTO summer_season_id
  FROM "seasons"
  WHERE "name" = 'Summer 2026' AND "year" = 2026
  LIMIT 1;

  IF summer_season_id IS NULL THEN
    RAISE EXCEPTION 'Summer 2026 season was not created';
  END IF;

  CREATE TEMP TABLE season_migration_counts (
    table_name TEXT PRIMARY KEY,
    row_count BIGINT NOT NULL
  ) ON COMMIT DROP;

  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I', table_name) INTO before_count;
    INSERT INTO season_migration_counts (table_name, row_count)
    VALUES (table_name, before_count);

    -- Phase 1: nullable so existing rows remain valid while the column is added.
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS "season_id" INTEGER',
      table_name
    );

    -- Phase 2: preserve every existing row and assign it to the real Summer season.
    EXECUTE format(
      'UPDATE %I SET "season_id" = $1 WHERE "season_id" IS NULL',
      table_name
    ) USING summer_season_id;

    -- Phase 3: do not continue if any row could not be assigned.
    EXECUTE format(
      'SELECT COUNT(*) FROM %I WHERE "season_id" IS NULL',
      table_name
    ) INTO null_count;

    IF null_count <> 0 THEN
      RAISE EXCEPTION 'Table % still has % rows without season_id', table_name, null_count;
    END IF;

    EXECUTE format('SELECT COUNT(*) FROM %I', table_name) INTO after_count;
    IF after_count <> before_count THEN
      RAISE EXCEPTION 'Table % changed row count from % to %', table_name, before_count, after_count;
    END IF;

    -- Only after verification is season_id made required.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN "season_id" SET NOT NULL',
      table_name
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I("season_id")',
      table_name || '_season_id_idx', table_name
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = table_name || '_season_id_fkey'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
        table_name,
        table_name || '_season_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- Preserve all snapshots while changing uniqueness from date-only to season + date.
ALTER TABLE "financial_snapshots"
  DROP CONSTRAINT IF EXISTS "financial_snapshots_snapshot_date_key";
DROP INDEX IF EXISTS "financial_snapshots_snapshot_date_key";
CREATE UNIQUE INDEX IF NOT EXISTS "financial_snapshots_season_id_snapshot_date_key"
  ON "financial_snapshots"("season_id", "snapshot_date");


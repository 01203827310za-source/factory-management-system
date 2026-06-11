-- Migration: add_model_parts
-- Run this SQL against your database, then run: npx prisma generate
-- ---------------------------------------------------------------

-- 1. Create the model_parts table
CREATE TABLE IF NOT EXISTS "model_parts" (
  "id"         SERIAL        NOT NULL,
  "model_id"   INTEGER       NOT NULL,
  "part_type"  TEXT          NOT NULL DEFAULT '',
  "cut_number" INTEGER       NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "model_parts_pkey" PRIMARY KEY ("id")
);

-- 2. Add FK constraint (cascades delete so parts are removed with their model)
ALTER TABLE "model_parts"
  ADD CONSTRAINT "model_parts_model_id_fkey"
  FOREIGN KEY ("model_id")
  REFERENCES "model_productions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Seed: create one ModelPart per existing model that already has a cut_number
--    Existing single-cut models become a single part with part_type = ''
INSERT INTO "model_parts" ("model_id", "part_type", "cut_number")
SELECT "id", '', "cut_number"
FROM   "model_productions"
WHERE  "cut_number" > 0
  AND  "id" NOT IN (SELECT DISTINCT "model_id" FROM "model_parts");

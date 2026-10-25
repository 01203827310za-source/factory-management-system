-- Sales: pieces added to an order that is «لم يتم الصرف» AFTER its stock effect was set. They count in the order quantity and value
-- (sales), but stock never sees them: no reservation, no deduction, no cost movement, no shortage — until the order is shipped as a whole.
-- Stock quantity of a line = model{i}_qty - model{i}_extra_qty. Additive with defaults: no existing row changes.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "model1_extra_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "model2_extra_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "model3_extra_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "model4_extra_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "model5_extra_qty" INTEGER NOT NULL DEFAULT 0;

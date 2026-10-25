-- Sales: an order saved as «لم يتم الصرف» while its pieces are not available yet keeps that status, but has NOT shipped.
-- awaiting_stock = true marks it: stock-wise it behaves like a reservation (FIFO hold, tracked shortage), nothing is deducted,
-- no cost movement, no receivable, no revenue. It clears when the pieces exist and the order is saved again (real shipment).
-- Additive with a default: no existing row changes.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "awaiting_stock" BOOLEAN NOT NULL DEFAULT false;

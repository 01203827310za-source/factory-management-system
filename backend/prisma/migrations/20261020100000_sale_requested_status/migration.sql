-- Sales: the status the user asked for when the order could not ship because the pieces are not available yet.
-- The order is held as «يتم التجهيز» (reservation + tracked shortage); this column only remembers what was requested so the
-- Sales screen can show it and a plain re-save retries the shipment. Additive and nullable: no existing row is changed.
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "requested_status" TEXT;

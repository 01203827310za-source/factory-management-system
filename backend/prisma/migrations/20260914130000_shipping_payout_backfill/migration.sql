-- Shipping payout confirmation feature — data-only migration, no schema change.
--
-- "sales.shipping_collected" already existed (added earlier as an informational
-- "collected from shipping" field) but was never read by any cash/receivables
-- calculation — every report instead assumed the FULL "remaining" balance of a
-- "تم الصرف" (dispatched) order had been collected in cash.
--
-- The application code has just been changed to read "shipping_collected" — the
-- actual amount confirmed as received from the shipping company — instead of the
-- full "remaining" balance, for every dispatched order's cash contribution.
--
-- To keep every historical financial total (cash, receivables, snapshots, reports)
-- IDENTICAL to what it was before this change, existing dispatched orders are
-- backfilled here so that shipping_collected reproduces the same total the old
-- "remaining"-based formula produced: shipping_collected := remaining.
--
-- This is a one-time backfill (Prisma only ever applies a migration once), so it
-- can never overwrite a genuine partial-collection amount recorded later by the
-- new "تأكيد مبلغ التحصيل" confirmation flow.
UPDATE "sales"
SET "shipping_collected" = "remaining"
WHERE "order_status" = 'تم الصرف';

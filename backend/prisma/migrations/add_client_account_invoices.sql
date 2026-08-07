-- Migration: add_client_account_invoices
-- Adds manual invoices that can be attached directly to a client account
-- (Client Accounts → "إضافة فاتورة"). Increases the account's outstanding
-- balance and shows up in the unified account history alongside payments.
-- Run this SQL against the database, then: npx prisma generate

CREATE TABLE IF NOT EXISTS "client_account_invoices" (
  "id"           SERIAL           NOT NULL,
  "account_id"   INTEGER          NOT NULL,
  "date"         TEXT             NOT NULL DEFAULT '',
  "order_number" TEXT             NOT NULL DEFAULT '',
  "amount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes"        TEXT             NOT NULL DEFAULT '',
  "created_by"   TEXT             NOT NULL DEFAULT '',
  "created_at"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_account_invoices_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_account_invoices_account_id_fkey') THEN
    ALTER TABLE "client_account_invoices"
      ADD CONSTRAINT "client_account_invoices_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "client_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

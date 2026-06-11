-- Payment history for debts
CREATE TABLE IF NOT EXISTS "debt_payments" (
  "id"             SERIAL           PRIMARY KEY,
  "debt_id"        INTEGER          NOT NULL REFERENCES "debts"("id") ON DELETE CASCADE,
  "payment_log_id" INTEGER,
  "date"           TEXT             NOT NULL DEFAULT '',
  "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payment_method" TEXT             NOT NULL DEFAULT '',
  "description"    TEXT             NOT NULL DEFAULT '',
  "receiver"       TEXT             NOT NULL DEFAULT '',
  "created_by"     TEXT             NOT NULL DEFAULT '',
  "created_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Payment history for client accounts
CREATE TABLE IF NOT EXISTS "client_account_payments" (
  "id"             SERIAL           PRIMARY KEY,
  "account_id"     INTEGER          NOT NULL REFERENCES "client_accounts"("id") ON DELETE CASCADE,
  "payment_log_id" INTEGER,
  "date"           TEXT             NOT NULL DEFAULT '',
  "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payment_method" TEXT             NOT NULL DEFAULT '',
  "description"    TEXT             NOT NULL DEFAULT '',
  "receiver"       TEXT             NOT NULL DEFAULT '',
  "created_by"     TEXT             NOT NULL DEFAULT '',
  "created_at"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Model production: optional idempotency key for entries recorded from the Ready Stock page. Additive; no existing row changes.
ALTER TABLE "model_productions" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "model_productions_idempotency_key_key" ON "model_productions"("idempotency_key");

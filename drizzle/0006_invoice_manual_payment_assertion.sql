-- Manual assertions are provenance only, never provider money.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "manual_payment_assertion" jsonb;

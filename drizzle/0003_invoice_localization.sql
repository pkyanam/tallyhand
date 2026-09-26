-- Invoice localization/payment fields (feature port: per-invoice currency,
-- tax region, tax IDs, email visibility, service period, payment details,
-- QR controls, amount-in-words, template variant).
-- Per-line taxRate/taxLabel ride inside the line_items jsonb — no column needed.
-- All columns nullable: existing invoices are untouched (absent = legacy behavior).
-- Mirrors src/lib/db/postgres-schema.ts. Applied automatically on container
-- start (deploy/entrypoint.sh) and by `npx drizzle-kit migrate`.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_region text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS seller_tax_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS seller_tax_id_label text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_tax_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS seller_email_visible boolean;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_email_visible boolean;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_start bigint;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS service_end bigint;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_url text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bank_account text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS swift_bic text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qr_enabled boolean;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qr_payload text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qr_description text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_in_words boolean;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS template text;

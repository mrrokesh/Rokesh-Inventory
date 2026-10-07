-- Multi-currency: foreign currencies with an exchange rate to the base currency, and every
-- transaction remembers its currency and the rate used (1 for base-currency transactions).
CREATE TABLE IF NOT EXISTS currencies (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  exchange_rate  NUMERIC(18,6) NOT NULL CHECK (exchange_rate > 0),   -- base currency per 1 unit
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['estimates','sales_orders','delivery_challans','invoices','credit_notes','purchase_orders','bills','vendor_credits','payments_received','payments_made'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS currency TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,6) NOT NULL DEFAULT 1', t);
  END LOOP;
END $$;

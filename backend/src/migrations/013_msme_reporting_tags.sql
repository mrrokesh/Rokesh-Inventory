-- MSME (Udyam) details on vendors, and reporting tags on transactions.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS msme_registered BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS msme_type TEXT;            -- micro | small | medium
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS udyam_number TEXT;

CREATE TABLE IF NOT EXISTS reporting_tags (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]',
  modules     TEXT[] NOT NULL DEFAULT '{}',     -- document types the tag is used on
  required    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['estimates','sales_orders','delivery_challans','invoices','credit_notes','purchase_orders','bills','vendor_credits'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT ''{}''', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gin (tags)', t || '_tags_idx', t);
  END LOOP;
END $$;

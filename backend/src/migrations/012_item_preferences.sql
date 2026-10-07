-- Item / inventory preferences.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS valuation_method TEXT NOT NULL DEFAULT 'fifo';
DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT organizations_valuation_method_chk CHECK (valuation_method IN ('fifo', 'wac'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS inventory_start_date DATE;
-- Existing organizations keep today's behaviour (duplicate names allowed).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allow_duplicate_item_names BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS items_org_barcode_idx ON items (org_id, lower(barcode)) WHERE barcode IS NOT NULL AND barcode <> '';

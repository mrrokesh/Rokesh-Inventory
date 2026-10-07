-- Custom fields (per record type), document (PDF) templates, digital signature and brand colour.

CREATE TABLE IF NOT EXISTS custom_fields (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity        TEXT NOT NULL,                 -- item, customer, vendor, sales_order, invoice, ...
  field_key     TEXT NOT NULL,                 -- stable key used in the JSON values
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL CHECK (field_type IN ('text','textarea','number','decimal','date','checkbox','dropdown','email','url','phone')),
  options       JSONB NOT NULL DEFAULT '[]',   -- dropdown choices
  required      BOOLEAN NOT NULL DEFAULT FALSE,
  default_value TEXT,
  pattern       TEXT,                          -- optional validation regex (text fields)
  pattern_message TEXT,
  help_text     TEXT,
  show_in_pdf   BOOLEAN NOT NULL DEFAULT TRUE,
  show_in_list  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity, field_key)
);
CREATE INDEX IF NOT EXISTS custom_fields_org_entity_idx ON custom_fields (org_id, entity, position);

ALTER TABLE items             ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE contacts          ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE estimates         ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE sales_orders      ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE invoices          ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE credit_notes      ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE purchase_orders   ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE bills             ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE vendor_credits    ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

-- Per document type print/PDF template settings (layout, colours, columns, notes, signature).
CREATE TABLE IF NOT EXISTS document_templates (
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type   TEXT NOT NULL,
  settings   JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, doc_type)
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS signature_path TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color TEXT;

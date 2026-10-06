-- Estimates, delivery challans, serial/batch tracking, customer portal, email,
-- GST place of supply, integrations (payment links, shipping, marketplace, API keys, webhooks).

-- ------------------------------------------------------------------ estimates (quotes)
CREATE TABLE estimates (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  reference        TEXT,
  contact_id       BIGINT NOT NULL REFERENCES contacts(id),
  doc_date         DATE NOT NULL,
  expiry_date      DATE,
  salesperson      TEXT,
  warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','converted')),
  sales_order_id   BIGINT REFERENCES sales_orders(id),
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment       NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total            NUMERIC(18,2) NOT NULL DEFAULT 0,
  billing_address  JSONB NOT NULL DEFAULT '{}',
  shipping_address JSONB NOT NULL DEFAULT '{}',
  notes            TEXT,
  terms            TEXT,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE estimate_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  item_id          BIGINT REFERENCES items(id),
  description      TEXT,
  quantity         NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  rate             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_id           BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  tax_rate         NUMERIC(7,3) NOT NULL DEFAULT 0,
  amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE sales_orders ADD COLUMN estimate_id BIGINT REFERENCES estimates(id);

-- ------------------------------------------------------------------ delivery challans
CREATE TABLE delivery_challans (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  reference        TEXT,
  contact_id       BIGINT NOT NULL REFERENCES contacts(id),
  doc_date         DATE NOT NULL,
  challan_type     TEXT NOT NULL DEFAULT 'supply_on_approval'
                   CHECK (challan_type IN ('supply_on_approval','job_work','supply_of_liquid_gas','others')),
  warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','delivered','returned','invoiced')),
  invoice_id       BIGINT,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment       NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total            NUMERIC(18,2) NOT NULL DEFAULT 0,
  billing_address  JSONB NOT NULL DEFAULT '{}',
  shipping_address JSONB NOT NULL DEFAULT '{}',
  notes            TEXT,
  terms            TEXT,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE delivery_challan_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
  item_id          BIGINT REFERENCES items(id),
  description      TEXT,
  quantity         NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  rate             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_id           BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  tax_rate         NUMERIC(7,3) NOT NULL DEFAULT 0,
  amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  tracking         JSONB,
  position         INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE invoices ADD COLUMN delivery_challan_id BIGINT REFERENCES delivery_challans(id);
ALTER TABLE delivery_challans ADD CONSTRAINT delivery_challans_invoice_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id);

-- ------------------------------------------------------------------ serial & batch tracking
ALTER TABLE items ADD COLUMN tracking TEXT NOT NULL DEFAULT 'none' CHECK (tracking IN ('none','serial','batch'));

CREATE TABLE serial_numbers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  serial       TEXT NOT NULL,
  warehouse_id BIGINT REFERENCES warehouses(id),
  status       TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','out')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, item_id, serial)
);
CREATE INDEX serial_numbers_stock_idx ON serial_numbers (item_id, warehouse_id, status);
CREATE INDEX serial_numbers_search_idx ON serial_numbers (org_id, lower(serial));

CREATE TABLE batches (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  batch_no     TEXT NOT NULL,
  mfg_date     DATE,
  expiry_date  DATE,
  quantity     NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, warehouse_id, batch_no)
);

-- Which serials / batches each stock movement used.
CREATE TABLE tracking_entries (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type  TEXT NOT NULL,
  source_id    BIGINT NOT NULL,
  item_id      BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  serial_id    BIGINT REFERENCES serial_numbers(id) ON DELETE CASCADE,
  batch_id     BIGINT REFERENCES batches(id) ON DELETE CASCADE,
  quantity     NUMERIC(18,3) NOT NULL,           -- signed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tracking_entries_source_idx ON tracking_entries (source_type, source_id);
CREATE INDEX tracking_entries_serial_idx ON tracking_entries (serial_id);

-- Tracking details chosen on lines (applied when stock moves).
ALTER TABLE package_lines ADD COLUMN tracking JSONB;
ALTER TABLE invoice_lines ADD COLUMN tracking JSONB;
ALTER TABLE bill_lines ADD COLUMN tracking JSONB;
ALTER TABLE vendor_credit_lines ADD COLUMN tracking JSONB;
ALTER TABLE inventory_adjustment_lines ADD COLUMN tracking JSONB;
ALTER TABLE transfer_order_lines ADD COLUMN tracking JSONB;
ALTER TABLE purchase_receive_lines ADD COLUMN tracking JSONB;
ALTER TABLE sales_return_lines ADD COLUMN tracking JSONB;

-- ------------------------------------------------------------------ GST place of supply
ALTER TABLE invoices ADD COLUMN place_of_supply TEXT;
ALTER TABLE credit_notes ADD COLUMN place_of_supply TEXT;
ALTER TABLE bills ADD COLUMN place_of_supply TEXT;
ALTER TABLE vendor_credits ADD COLUMN place_of_supply TEXT;
ALTER TABLE sales_orders ADD COLUMN place_of_supply TEXT;
ALTER TABLE purchase_orders ADD COLUMN place_of_supply TEXT;
ALTER TABLE estimates ADD COLUMN place_of_supply TEXT;
ALTER TABLE delivery_challans ADD COLUMN place_of_supply TEXT;

-- ------------------------------------------------------------------ customer portal & comments
ALTER TABLE contacts ADD COLUMN portal_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN portal_password_hash TEXT;
ALTER TABLE contacts ADD COLUMN portal_token TEXT UNIQUE;
ALTER TABLE contacts ADD COLUMN portal_last_login TIMESTAMPTZ;
CREATE UNIQUE INDEX contacts_portal_email_uq ON contacts (org_id, lower(email)) WHERE portal_enabled AND contact_type = 'customer';

CREATE TABLE comments (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id   BIGINT NOT NULL,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  contact_id  BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,     -- internal notes are never shown in the portal
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_entity_idx ON comments (org_id, entity_type, entity_id);

-- ------------------------------------------------------------------ email
ALTER TABLE organizations ADD COLUMN smtp JSONB;          -- host, port, secure, user, from_name, from_email (password encrypted)
CREATE TABLE email_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT,
  entity_id   BIGINT,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error       TEXT,
  sent_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_entity_idx ON email_log (org_id, entity_type, entity_id);

-- ------------------------------------------------------------------ integrations
CREATE TABLE integrations (
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  config       JSONB NOT NULL DEFAULT '{}',          -- non-secret settings
  secrets      TEXT,                                  -- encrypted JSON
  state        JSONB NOT NULL DEFAULT '{}',          -- cursors, cached tokens (non-secret)
  last_sync_at TIMESTAMPTZ,
  last_error   TEXT,
  PRIMARY KEY (org_id, provider)
);
CREATE TABLE integration_logs (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  action     TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('success','error')),
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX integration_logs_idx ON integration_logs (org_id, provider, created_at DESC);

ALTER TABLE invoices ADD COLUMN payment_link_id TEXT;
ALTER TABLE invoices ADD COLUMN payment_link_url TEXT;
ALTER TABLE payments_received ADD COLUMN gateway_payment_id TEXT;
CREATE UNIQUE INDEX payments_gateway_uq ON payments_received (org_id, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;

ALTER TABLE shipments ADD COLUMN provider TEXT;
ALTER TABLE shipments ADD COLUMN external_id TEXT;
ALTER TABLE shipments ADD COLUMN label_url TEXT;

ALTER TABLE sales_orders ADD COLUMN channel TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE sales_orders ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX sales_orders_external_uq ON sales_orders (org_id, channel, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE api_keys (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- the key acts with this user's role
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  events     TEXT[] NOT NULL,
  secret     TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE webhook_deliveries (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_id      BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_pending_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

-- ------------------------------------------------------------------ numbering & permissions for existing orgs
INSERT INTO number_series (org_id, doc_type, prefix, padding)
SELECT id, 'estimate', 'EST-', 5 FROM organizations ON CONFLICT DO NOTHING;
INSERT INTO number_series (org_id, doc_type, prefix, padding)
SELECT id, 'delivery_challan', 'DC-', 5 FROM organizations ON CONFLICT DO NOTHING;

UPDATE roles SET permissions = permissions
  || '{"estimates":["view","create","edit","delete","approve"],"delivery_challans":["view","create","edit","delete","approve"]}'::jsonb
 WHERE name = 'Manager' AND NOT is_admin;
UPDATE roles SET permissions = permissions
  || '{"estimates":["view","create","edit","approve"],"delivery_challans":["view","create","edit","approve"]}'::jsonb
 WHERE name = 'Sales User' AND NOT is_admin;
UPDATE roles SET permissions = permissions || '{"delivery_challans":["view","create","edit"]}'::jsonb
 WHERE name = 'Warehouse User' AND NOT is_admin;
UPDATE roles SET permissions = permissions || '{"estimates":["view"],"delivery_challans":["view"]}'::jsonb
 WHERE name = 'Accountant' AND NOT is_admin;

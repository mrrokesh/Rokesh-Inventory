-- Optional modules (Zoho-style Configure Features), retainer invoices, and in-app notifications.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}';

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS retainers_applied NUMERIC(18,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS retainers (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  reference        TEXT,
  contact_id       BIGINT NOT NULL REFERENCES contacts(id),
  doc_date         DATE NOT NULL,
  due_date         DATE NOT NULL,
  payment_terms    INTEGER NOT NULL DEFAULT 0,
  salesperson      TEXT,
  warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_paid','paid','closed','void')),
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment       NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total            NUMERIC(18,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(18,2) NOT NULL DEFAULT 0,
  amount_applied   NUMERIC(18,2) NOT NULL DEFAULT 0,
  unused           NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(18,2) NOT NULL DEFAULT 0,
  billing_address  JSONB NOT NULL DEFAULT '{}',
  shipping_address JSONB NOT NULL DEFAULT '{}',
  notes            TEXT,
  terms            TEXT,
  place_of_supply  TEXT,
  custom_fields    JSONB NOT NULL DEFAULT '{}',
  tags             JSONB NOT NULL DEFAULT '{}',
  currency         TEXT,
  exchange_rate    NUMERIC(18,6) NOT NULL DEFAULT 1,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE IF NOT EXISTS retainer_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS retainers_org_idx ON retainers (org_id, doc_date DESC);
CREATE INDEX IF NOT EXISTS retainers_contact_idx ON retainers (contact_id);
CREATE INDEX IF NOT EXISTS retainer_lines_doc_idx ON retainer_lines (doc_id);
CREATE INDEX IF NOT EXISTS retainers_tags_idx ON retainers USING gin (tags);

CREATE TABLE IF NOT EXISTS retainer_payments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  retainer_id  BIGINT NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
  amount       NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  mode         TEXT NOT NULL DEFAULT 'bank_transfer',
  reference    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retainer_payments_doc_idx ON retainer_payments (retainer_id);

CREATE TABLE IF NOT EXISTS retainer_applications (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  retainer_id  BIGINT NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
  invoice_id   BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount       NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  applied_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS retainer_applications_ret_idx ON retainer_applications (retainer_id);
CREATE INDEX IF NOT EXISTS retainer_applications_inv_idx ON retainer_applications (invoice_id);

INSERT INTO number_series (org_id, doc_type, prefix, next_number, padding)
SELECT o.id, 'retainer_invoice', 'RI-', 1, 5
  FROM organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM number_series n WHERE n.org_id = o.id AND n.doc_type = 'retainer_invoice'
 );

UPDATE roles
   SET permissions = permissions || '{"retainers":["view","create","edit","delete","approve"]}'::jsonb
 WHERE NOT is_admin
   AND permissions ? 'invoices'
   AND NOT (permissions ? 'retainers');

CREATE TABLE IF NOT EXISTS notifications (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event','mention')),
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,
  entity_type  TEXT,
  entity_id    BIGINT,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- Core schema for the inventory application.
-- Every business table is scoped by org_id (multi-tenant).

CREATE TABLE organizations (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             TEXT NOT NULL,
  legal_name       TEXT,
  industry         TEXT,
  email            TEXT,
  phone            TEXT,
  website          TEXT,
  address          JSONB NOT NULL DEFAULT '{}',
  country          TEXT NOT NULL DEFAULT 'India',
  state            TEXT,
  currency         TEXT NOT NULL DEFAULT 'INR',
  timezone         TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  fiscal_year_start SMALLINT NOT NULL DEFAULT 4,          -- month number (4 = April)
  date_format      TEXT NOT NULL DEFAULT 'dd/MM/yyyy',
  gst_registered   BOOLEAN NOT NULL DEFAULT FALSE,
  gstin            TEXT,
  pan              TEXT,
  logo_path        TEXT,
  allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
  portal_slug      TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  permissions JSONB NOT NULL DEFAULT '{}',   -- { module: ["view","create","edit","delete","approve","export","import"] }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id       BIGINT NOT NULL REFERENCES roles(id),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','inactive')),
  invite_token  TEXT UNIQUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE taxes (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  rate       NUMERIC(7,3) NOT NULL CHECK (rate >= 0),
  kind       TEXT NOT NULL DEFAULT 'tax' CHECK (kind IN ('tax','tds','tcs')),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name   TEXT NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE warehouses (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  code           TEXT,
  address        JSONB NOT NULL DEFAULT '{}',
  contact_person TEXT,
  phone          TEXT,
  email          TEXT,
  is_primary     BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE number_series (
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,
  prefix      TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  padding     SMALLINT NOT NULL DEFAULT 5,
  PRIMARY KEY (org_id, doc_type)
);

CREATE TABLE shipping_carriers (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  tracking_url TEXT,               -- use {tracking} as placeholder
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (org_id, name)
);

-- ---------------------------------------------------------------- contacts
CREATE TABLE price_lists (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'sales' CHECK (kind IN ('sales','purchase')),
  scheme      TEXT NOT NULL DEFAULT 'percentage' CHECK (scheme IN ('percentage','per_item')),
  markup      BOOLEAN NOT NULL DEFAULT TRUE,          -- true = markup, false = markdown
  percentage  NUMERIC(7,3) NOT NULL DEFAULT 0,
  rounding    TEXT NOT NULL DEFAULT 'none' CHECK (rounding IN ('none','whole','0.99','0.50')),
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE contacts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_type    TEXT NOT NULL CHECK (contact_type IN ('customer','vendor')),
  customer_type   TEXT NOT NULL DEFAULT 'business' CHECK (customer_type IN ('business','individual')),
  salutation      TEXT,
  first_name      TEXT,
  last_name       TEXT,
  company_name    TEXT,
  display_name    TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  mobile          TEXT,
  website         TEXT,
  pan             TEXT,
  gst_treatment   TEXT,               -- registered, unregistered, consumer, sez, overseas
  gstin           TEXT,
  place_of_supply TEXT,
  currency        TEXT NOT NULL DEFAULT 'INR',
  payment_terms   INTEGER NOT NULL DEFAULT 0,          -- days; 0 = due on receipt
  credit_limit    NUMERIC(18,2),
  price_list_id   BIGINT REFERENCES price_lists(id) ON DELETE SET NULL,
  billing_address JSONB NOT NULL DEFAULT '{}',
  shipping_address JSONB NOT NULL DEFAULT '{}',
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_org_type_idx ON contacts (org_id, contact_type, display_name);

CREATE TABLE contact_persons (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id  BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  designation TEXT
);

-- ---------------------------------------------------------------- items
CREATE TABLE item_groups (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  unit        TEXT,
  category    TEXT,
  brand       TEXT,
  attributes  JSONB NOT NULL DEFAULT '[]',   -- [{ "name": "Color", "options": ["Red","Blue"] }]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id              BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  group_id            BIGINT REFERENCES item_groups(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  sku                 TEXT,
  barcode             TEXT,
  item_type           TEXT NOT NULL DEFAULT 'goods' CHECK (item_type IN ('goods','service')),
  is_composite        BOOLEAN NOT NULL DEFAULT FALSE,
  track_inventory     BOOLEAN NOT NULL DEFAULT TRUE,
  unit                TEXT,
  category            TEXT,
  brand               TEXT,
  manufacturer        TEXT,
  description         TEXT,
  attributes          JSONB NOT NULL DEFAULT '{}',  -- variant values { "Color": "Red" }
  hsn_sac             TEXT,
  selling_price       NUMERIC(18,2) NOT NULL DEFAULT 0,
  cost_price          NUMERIC(18,2) NOT NULL DEFAULT 0,
  sales_description   TEXT,
  purchase_description TEXT,
  sales_tax_id        BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  purchase_tax_id     BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  preferred_vendor_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  reorder_level       NUMERIC(18,3) NOT NULL DEFAULT 0,
  returnable          BOOLEAN NOT NULL DEFAULT TRUE,
  length_cm           NUMERIC(10,2),
  width_cm            NUMERIC(10,2),
  height_cm           NUMERIC(10,2),
  weight_kg           NUMERIC(10,3),
  image_path          TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (item_type = 'goods' OR track_inventory = FALSE)
);
CREATE UNIQUE INDEX items_sku_uq ON items (org_id, lower(sku)) WHERE sku IS NOT NULL AND sku <> '';
CREATE INDEX items_org_name_idx ON items (org_id, name);
CREATE INDEX items_group_idx ON items (group_id);

CREATE TABLE composite_components (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  composite_item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  component_item_id BIGINT NOT NULL REFERENCES items(id),
  quantity          NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (composite_item_id, component_item_id),
  CHECK (composite_item_id <> component_item_id)
);

CREATE TABLE price_list_items (
  price_list_id BIGINT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  rate          NUMERIC(18,2) NOT NULL,
  PRIMARY KEY (price_list_id, item_id)
);

-- ---------------------------------------------------------------- stock
CREATE TABLE stock_levels (
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id      BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  on_hand      NUMERIC(18,3) NOT NULL DEFAULT 0,
  committed    NUMERIC(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, warehouse_id)
);
CREATE INDEX stock_levels_org_idx ON stock_levels (org_id);

-- FIFO cost layers
CREATE TABLE stock_lots (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  lot_date      DATE NOT NULL,
  qty_in        NUMERIC(18,3) NOT NULL,
  qty_remaining NUMERIC(18,3) NOT NULL,
  unit_cost     NUMERIC(18,4) NOT NULL,
  source_type   TEXT NOT NULL,
  source_id     BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_lots_fifo_idx ON stock_lots (item_id, warehouse_id, lot_date, id) WHERE qty_remaining > 0;
CREATE INDEX stock_lots_source_idx ON stock_lots (source_type, source_id);

CREATE TABLE stock_movements (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  movement_date DATE NOT NULL,
  quantity      NUMERIC(18,3) NOT NULL,        -- signed: + in, - out
  value         NUMERIC(18,2) NOT NULL,        -- signed cost value
  source_type   TEXT NOT NULL,
  source_id     BIGINT NOT NULL,
  source_number TEXT,
  note          TEXT,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_item_idx ON stock_movements (org_id, item_id, movement_date);
CREATE INDEX stock_movements_source_idx ON stock_movements (source_type, source_id);

CREATE TABLE inventory_adjustments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number       TEXT NOT NULL,
  reference    TEXT,
  mode         TEXT NOT NULL DEFAULT 'quantity' CHECK (mode IN ('quantity','value')),
  adj_date     DATE NOT NULL,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  account      TEXT NOT NULL DEFAULT 'Cost of Goods Sold',
  reason       TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','adjusted')),
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE inventory_adjustment_lines (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adjustment_id BIGINT NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
  item_id       BIGINT NOT NULL REFERENCES items(id),
  qty_adjusted  NUMERIC(18,3) NOT NULL DEFAULT 0,    -- quantity mode (signed)
  unit_cost     NUMERIC(18,4),                       -- cost for positive quantity adjustments
  value_adjusted NUMERIC(18,2) NOT NULL DEFAULT 0,   -- value mode (signed)
  position      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transfer_orders (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  transfer_date     DATE NOT NULL,
  from_warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id   BIGINT NOT NULL REFERENCES warehouses(id),
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','received')),
  received_date     DATE,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number),
  CHECK (from_warehouse_id <> to_warehouse_id)
);
CREATE TABLE transfer_order_lines (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_order_id BIGINT NOT NULL REFERENCES transfer_orders(id) ON DELETE CASCADE,
  item_id           BIGINT NOT NULL REFERENCES items(id),
  quantity          NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  unit_cost         NUMERIC(18,4),                   -- set when dispatched
  position          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE assemblies (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  composite_item_id BIGINT NOT NULL REFERENCES items(id),
  warehouse_id      BIGINT NOT NULL REFERENCES warehouses(id),
  quantity          NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  assembly_date     DATE NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'assemble' CHECK (kind IN ('assemble','disassemble')),
  notes             TEXT,
  total_cost        NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

-- ---------------------------------------------------------------- sales
CREATE TABLE sales_orders (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                 BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number                 TEXT NOT NULL,
  reference              TEXT,
  contact_id             BIGINT NOT NULL REFERENCES contacts(id),
  doc_date               DATE NOT NULL,
  expected_shipment_date DATE,
  payment_terms          INTEGER NOT NULL DEFAULT 0,
  delivery_method        TEXT,
  salesperson            TEXT,
  warehouse_id           BIGINT NOT NULL REFERENCES warehouses(id),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','closed','void')),
  discount_percent       NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge        NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment             NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total              NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total         NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total              NUMERIC(18,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(18,2) NOT NULL DEFAULT 0,
  billing_address        JSONB NOT NULL DEFAULT '{}',
  shipping_address       JSONB NOT NULL DEFAULT '{}',
  notes                  TEXT,
  terms                  TEXT,
  created_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE sales_order_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_id          BIGINT REFERENCES items(id),
  description      TEXT,
  quantity         NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  rate             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_id           BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  tax_rate         NUMERIC(7,3) NOT NULL DEFAULT 0,
  amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  qty_packed       NUMERIC(18,3) NOT NULL DEFAULT 0,
  qty_shipped      NUMERIC(18,3) NOT NULL DEFAULT 0,
  qty_invoiced     NUMERIC(18,3) NOT NULL DEFAULT 0,
  qty_returned     NUMERIC(18,3) NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sales_orders_org_idx ON sales_orders (org_id, doc_date DESC);
CREATE INDEX sales_order_lines_doc_idx ON sales_order_lines (doc_id);

CREATE TABLE packages (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  sales_order_id BIGINT NOT NULL REFERENCES sales_orders(id),
  contact_id     BIGINT NOT NULL REFERENCES contacts(id),
  package_date   DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'not_shipped' CHECK (status IN ('not_shipped','shipped','delivered')),
  length_cm      NUMERIC(10,2),
  width_cm       NUMERIC(10,2),
  height_cm      NUMERIC(10,2),
  weight_kg      NUMERIC(10,3),
  notes          TEXT,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE package_lines (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  so_line_id BIGINT NOT NULL REFERENCES sales_order_lines(id),
  item_id    BIGINT NOT NULL REFERENCES items(id),
  quantity   NUMERIC(18,3) NOT NULL CHECK (quantity > 0)
);

CREATE TABLE shipments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number             TEXT NOT NULL,
  package_id         BIGINT NOT NULL UNIQUE REFERENCES packages(id),
  sales_order_id     BIGINT NOT NULL REFERENCES sales_orders(id),
  contact_id         BIGINT NOT NULL REFERENCES contacts(id),
  ship_date          DATE NOT NULL,
  carrier            TEXT,
  service_type       TEXT,
  tracking_number    TEXT,
  shipping_cost      NUMERIC(18,2) NOT NULL DEFAULT 0,
  estimated_delivery DATE,
  delivered_date     DATE,
  status             TEXT NOT NULL DEFAULT 'shipped' CHECK (status IN ('shipped','in_transit','delivered','returned','failed')),
  notes              TEXT,
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE invoices (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  reference        TEXT,
  contact_id       BIGINT NOT NULL REFERENCES contacts(id),
  sales_order_id   BIGINT REFERENCES sales_orders(id),
  doc_date         DATE NOT NULL,
  due_date         DATE NOT NULL,
  payment_terms    INTEGER NOT NULL DEFAULT 0,
  salesperson      TEXT,
  warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partially_paid','paid','void')),
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment       NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total            NUMERIC(18,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(18,2) NOT NULL DEFAULT 0,
  credits_applied  NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(18,2) NOT NULL DEFAULT 0,
  billing_address  JSONB NOT NULL DEFAULT '{}',
  shipping_address JSONB NOT NULL DEFAULT '{}',
  notes            TEXT,
  terms            TEXT,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE invoice_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  so_line_id       BIGINT REFERENCES sales_order_lines(id),
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
CREATE INDEX invoices_org_idx ON invoices (org_id, doc_date DESC);
CREATE INDEX invoices_contact_idx ON invoices (contact_id);
CREATE INDEX invoice_lines_doc_idx ON invoice_lines (doc_id);

CREATE TABLE payments_received (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  contact_id     BIGINT NOT NULL REFERENCES contacts(id),
  payment_date   DATE NOT NULL,
  amount         NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  mode           TEXT NOT NULL DEFAULT 'cash',
  reference      TEXT,
  bank_charges   NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes          TEXT,
  unused_amount  NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE payment_received_allocations (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments_received(id) ON DELETE CASCADE,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id),
  amount     NUMERIC(18,2) NOT NULL CHECK (amount > 0)
);

CREATE TABLE sales_returns (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  sales_order_id BIGINT NOT NULL REFERENCES sales_orders(id),
  contact_id     BIGINT NOT NULL REFERENCES contacts(id),
  return_date    DATE NOT NULL,
  warehouse_id   BIGINT NOT NULL REFERENCES warehouses(id),
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','received','credited')),
  received_date  DATE,
  created_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE sales_return_lines (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sales_return_id BIGINT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  so_line_id      BIGINT NOT NULL REFERENCES sales_order_lines(id),
  item_id         BIGINT NOT NULL REFERENCES items(id),
  quantity        NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  restock         BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE credit_notes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  reference        TEXT,
  contact_id       BIGINT NOT NULL REFERENCES contacts(id),
  invoice_id       BIGINT REFERENCES invoices(id),
  sales_return_id  BIGINT REFERENCES sales_returns(id),
  doc_date         DATE NOT NULL,
  warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','void')),
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment       NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total            NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  terms            TEXT,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE credit_note_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
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
CREATE TABLE credit_applications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credit_note_id BIGINT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  invoice_id     BIGINT NOT NULL REFERENCES invoices(id),
  amount         NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  applied_date   DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE TABLE credit_refunds (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credit_note_id BIGINT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  refund_date    DATE NOT NULL,
  amount         NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  mode           TEXT NOT NULL DEFAULT 'cash',
  reference      TEXT
);

-- ---------------------------------------------------------------- purchases
CREATE TABLE purchase_orders (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id                 BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number                 TEXT NOT NULL,
  reference              TEXT,
  contact_id             BIGINT NOT NULL REFERENCES contacts(id),
  doc_date               DATE NOT NULL,
  expected_delivery_date DATE,
  payment_terms          INTEGER NOT NULL DEFAULT 0,
  shipment_preference    TEXT,
  warehouse_id           BIGINT NOT NULL REFERENCES warehouses(id),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled','closed')),
  discount_percent       NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge        NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment             NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total              NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total         NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total              NUMERIC(18,2) NOT NULL DEFAULT 0,
  total                  NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes                  TEXT,
  terms                  TEXT,
  created_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE purchase_order_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id          BIGINT REFERENCES items(id),
  description      TEXT,
  quantity         NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  rate             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_id           BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  tax_rate         NUMERIC(7,3) NOT NULL DEFAULT 0,
  amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  qty_received     NUMERIC(18,3) NOT NULL DEFAULT 0,
  qty_billed       NUMERIC(18,3) NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX purchase_orders_org_idx ON purchase_orders (org_id, doc_date DESC);
CREATE INDEX purchase_order_lines_doc_idx ON purchase_order_lines (doc_id);

CREATE TABLE purchase_receives (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,
  purchase_order_id BIGINT NOT NULL REFERENCES purchase_orders(id),
  contact_id        BIGINT NOT NULL REFERENCES contacts(id),
  receive_date      DATE NOT NULL,
  warehouse_id      BIGINT NOT NULL REFERENCES warehouses(id),
  notes             TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE purchase_receive_lines (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receive_id  BIGINT NOT NULL REFERENCES purchase_receives(id) ON DELETE CASCADE,
  po_line_id  BIGINT NOT NULL REFERENCES purchase_order_lines(id),
  item_id     BIGINT NOT NULL REFERENCES items(id),
  quantity    NUMERIC(18,3) NOT NULL CHECK (quantity > 0)
);

CREATE TABLE bills (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id            BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number            TEXT NOT NULL,                   -- vendor's bill number
  reference         TEXT,
  contact_id        BIGINT NOT NULL REFERENCES contacts(id),
  purchase_order_id BIGINT REFERENCES purchase_orders(id),
  doc_date          DATE NOT NULL,
  due_date          DATE NOT NULL,
  payment_terms     INTEGER NOT NULL DEFAULT 0,
  warehouse_id      BIGINT NOT NULL REFERENCES warehouses(id),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','partially_paid','paid','void')),
  discount_percent  NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge   NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment        NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total         NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total    NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total         NUMERIC(18,2) NOT NULL DEFAULT 0,
  total             NUMERIC(18,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(18,2) NOT NULL DEFAULT 0,
  credits_applied   NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance           NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  terms             TEXT,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, contact_id, number)
);
CREATE TABLE bill_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  po_line_id       BIGINT REFERENCES purchase_order_lines(id),
  item_id          BIGINT REFERENCES items(id),
  description      TEXT,
  account          TEXT,
  quantity         NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  rate             NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  tax_id           BIGINT REFERENCES taxes(id) ON DELETE SET NULL,
  tax_rate         NUMERIC(7,3) NOT NULL DEFAULT 0,
  amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX bills_org_idx ON bills (org_id, doc_date DESC);
CREATE INDEX bill_lines_doc_idx ON bill_lines (doc_id);

CREATE TABLE payments_made (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  contact_id    BIGINT NOT NULL REFERENCES contacts(id),
  payment_date  DATE NOT NULL,
  amount        NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  mode          TEXT NOT NULL DEFAULT 'cash',
  reference     TEXT,
  notes         TEXT,
  unused_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE payment_made_allocations (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments_made(id) ON DELETE CASCADE,
  bill_id    BIGINT NOT NULL REFERENCES bills(id),
  amount     NUMERIC(18,2) NOT NULL CHECK (amount > 0)
);

CREATE TABLE vendor_credits (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  reference        TEXT,
  contact_id       BIGINT NOT NULL REFERENCES contacts(id),
  bill_id          BIGINT REFERENCES bills(id),
  doc_date         DATE NOT NULL,
  warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  return_stock     BOOLEAN NOT NULL DEFAULT FALSE,     -- goods physically returned to vendor
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','void')),
  discount_percent NUMERIC(7,3) NOT NULL DEFAULT 0,
  shipping_charge  NUMERIC(18,2) NOT NULL DEFAULT 0,
  adjustment       NUMERIC(18,2) NOT NULL DEFAULT 0,
  sub_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  discount_total   NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
  total            NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance          NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes            TEXT,
  terms            TEXT,
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE TABLE vendor_credit_lines (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id           BIGINT NOT NULL REFERENCES vendor_credits(id) ON DELETE CASCADE,
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
CREATE TABLE vendor_credit_applications (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_credit_id BIGINT NOT NULL REFERENCES vendor_credits(id) ON DELETE CASCADE,
  bill_id          BIGINT NOT NULL REFERENCES bills(id),
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  applied_date     DATE NOT NULL DEFAULT CURRENT_DATE
);

-- ---------------------------------------------------------------- documents & audit
CREATE TABLE documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  stored_name  TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT NOT NULL DEFAULT 0,
  category     TEXT,
  entity_type  TEXT,
  entity_id    BIGINT,
  uploaded_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_entity_idx ON documents (org_id, entity_type, entity_id);

CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   BIGINT,
  summary     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (org_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (org_id, entity_type, entity_id);

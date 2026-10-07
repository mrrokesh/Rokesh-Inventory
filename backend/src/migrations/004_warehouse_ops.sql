-- Stock counts, picklists, tasks (Zoho Inventory parity modules) + bill numbering.

INSERT INTO number_series (org_id, doc_type, prefix, padding)
SELECT o.id, 'bill', 'BILL-', 5 FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM number_series n WHERE n.org_id = o.id AND n.doc_type = 'bill');

INSERT INTO number_series (org_id, doc_type, prefix, padding)
SELECT o.id, 'stock_count', 'SC-', 5 FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM number_series n WHERE n.org_id = o.id AND n.doc_type = 'stock_count');

INSERT INTO number_series (org_id, doc_type, prefix, padding)
SELECT o.id, 'picklist', 'PL-', 5 FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM number_series n WHERE n.org_id = o.id AND n.doc_type = 'picklist');

CREATE TABLE IF NOT EXISTS stock_counts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          TEXT NOT NULL,
  count_date      DATE NOT NULL,
  warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed','cancelled')),
  notes           TEXT,
  adjustment_id   BIGINT REFERENCES inventory_adjustments(id) ON DELETE SET NULL,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stock_count_id  BIGINT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id         BIGINT NOT NULL REFERENCES items(id),
  system_qty      NUMERIC(18,3) NOT NULL DEFAULT 0,
  counted_qty     NUMERIC(18,3),
  position        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (stock_count_id, item_id)
);

CREATE TABLE IF NOT EXISTS picklists (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number          TEXT NOT NULL,
  pick_date       DATE NOT NULL,
  warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id),
  sales_order_id  BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','picked','cancelled')),
  notes           TEXT,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  picked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE IF NOT EXISTS picklist_lines (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  picklist_id     BIGINT NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
  item_id         BIGINT NOT NULL REFERENCES items(id),
  sales_order_line_id BIGINT,
  quantity_to_pick NUMERIC(18,3) NOT NULL CHECK (quantity_to_pick > 0),
  quantity_picked NUMERIC(18,3) NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled')),
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_date        DATE,
  assignee_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  related_type    TEXT,
  related_id      BIGINT,
  related_number  TEXT,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_org_status_idx ON tasks (org_id, status);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id);

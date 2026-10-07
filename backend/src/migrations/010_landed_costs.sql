-- Landed costs: freight, customs, insurance etc. spread over received goods,
-- raising the unit cost of the FIFO lots they created.
CREATE TABLE IF NOT EXISTS landed_costs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number           TEXT NOT NULL,
  cost_date        DATE NOT NULL,
  bill_id          BIGINT REFERENCES bills(id) ON DELETE SET NULL,   -- the bill for the charges (optional)
  description      TEXT,
  amount           NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  method           TEXT NOT NULL CHECK (method IN ('quantity', 'value', 'weight', 'manual')),
  status           TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'void')),
  applied_to_stock NUMERIC(18,2) NOT NULL DEFAULT 0,                -- part added to stock still on hand
  expensed         NUMERIC(18,2) NOT NULL DEFAULT 0,                -- part belonging to units already used
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at        TIMESTAMPTZ,
  UNIQUE (org_id, number)
);
CREATE INDEX IF NOT EXISTS landed_costs_bill_idx ON landed_costs (bill_id);

CREATE TABLE IF NOT EXISTS landed_cost_lines (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  landed_cost_id      BIGINT NOT NULL REFERENCES landed_costs(id) ON DELETE CASCADE,
  lot_id              BIGINT REFERENCES stock_lots(id) ON DELETE SET NULL,
  source_type         TEXT NOT NULL,              -- purchase_receive | bill
  source_id           BIGINT NOT NULL,
  source_number       TEXT,
  item_id             BIGINT NOT NULL REFERENCES items(id),
  warehouse_id        BIGINT NOT NULL REFERENCES warehouses(id),
  quantity            NUMERIC(18,3) NOT NULL,     -- units received in the lot
  base_value          NUMERIC(18,2) NOT NULL,     -- lot value before the landed cost
  amount              NUMERIC(18,2) NOT NULL,     -- landed cost allocated to this lot
  per_unit            NUMERIC(18,6) NOT NULL,
  remaining_at_apply  NUMERIC(18,3) NOT NULL
);
CREATE INDEX IF NOT EXISTS landed_cost_lines_source_idx ON landed_cost_lines (source_type, source_id);
CREATE INDEX IF NOT EXISTS landed_cost_lines_lot_idx ON landed_cost_lines (lot_id);

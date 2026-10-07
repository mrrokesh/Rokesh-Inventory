-- Workflow rules (automation): when a record is created/edited/approved/voided, or on a
-- date relative to one of its dates, check conditions and run actions.
CREATE TABLE IF NOT EXISTS workflow_rules (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  module          TEXT NOT NULL,                       -- invoice, sales_order, item, customer, ...
  trigger_type    TEXT NOT NULL DEFAULT 'event' CHECK (trigger_type IN ('event', 'date')),
  events          TEXT[] NOT NULL DEFAULT '{}',        -- create, update, approve, void (trigger_type = event)
  date_field      TEXT,                                -- e.g. due_date (trigger_type = date)
  offset_days     INTEGER NOT NULL DEFAULT 0,          -- run N days after (+) / before (-) that date
  match           TEXT NOT NULL DEFAULT 'all' CHECK (match IN ('all', 'any')),
  conditions      JSONB NOT NULL DEFAULT '[]',         -- [{ field, op, value }]
  actions         JSONB NOT NULL DEFAULT '[]',         -- [{ type: email|webhook|field_update|task, ... }]
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  run_count       INTEGER NOT NULL DEFAULT 0,
  last_run_at     TIMESTAMPTZ,
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_rules_org_module_idx ON workflow_rules (org_id, module) WHERE is_active;

-- Events waiting to be checked against rules (queued in the same transaction as the change).
CREATE TABLE IF NOT EXISTS workflow_queue (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module          TEXT NOT NULL,
  event           TEXT NOT NULL,
  entity_id       BIGINT NOT NULL,
  user_id         BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per rule run (shown under Settings -> Workflow rules -> Logs).
CREATE TABLE IF NOT EXISTS workflow_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         BIGINT REFERENCES workflow_rules(id) ON DELETE SET NULL,
  rule_name       TEXT NOT NULL,
  module          TEXT NOT NULL,
  entity_id       BIGINT,
  entity_label    TEXT,
  trigger         TEXT NOT NULL,                       -- create / update / ... / date:2026-10-08
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  results         JSONB NOT NULL DEFAULT '[]',         -- [{ type, ok, message }]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_logs_org_idx ON workflow_logs (org_id, created_at DESC);
-- A date-based rule runs at most once per record per day.
CREATE UNIQUE INDEX IF NOT EXISTS workflow_logs_date_once_uq ON workflow_logs (rule_id, entity_id, trigger) WHERE trigger LIKE 'date:%';

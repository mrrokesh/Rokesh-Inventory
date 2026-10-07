-- Platform (super-admin) layer for selling to many clients.

CREATE TABLE plans (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  max_users       INT,                          -- NULL = unlimited
  max_warehouses  INT,
  max_items       INT,
  modules         JSONB NOT NULL DEFAULT '{}',  -- feature flags
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (code, name, description, max_users, max_warehouses, max_items, modules, sort_order) VALUES
  ('starter',  'Starter',  'Small teams getting started', 3, 1, 500, '{"shopify":false,"shiprocket":false,"portal":true,"announcements":true}'::jsonb, 1),
  ('growth',   'Growth',   'Growing businesses', 10, 5, 5000, '{"shopify":true,"shiprocket":true,"portal":true,"announcements":true}'::jsonb, 2),
  ('business', 'Business', 'Larger operations', 50, 20, 50000, '{"shopify":true,"shiprocket":true,"portal":true,"announcements":true}'::jsonb, 3);

ALTER TABLE organizations
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  ADD COLUMN plan_id BIGINT REFERENCES plans(id),
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN platform_notes TEXT;

UPDATE organizations o
   SET plan_id = p.id
  FROM plans p
 WHERE o.plan_id IS NULL AND p.code = 'growth';

CREATE TABLE platform_admins (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_email_uq ON platform_admins (lower(email));

CREATE TABLE platform_audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    BIGINT REFERENCES platform_admins(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   BIGINT,
  detail      TEXT,
  meta        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_log_created_idx ON platform_audit_log (created_at DESC);

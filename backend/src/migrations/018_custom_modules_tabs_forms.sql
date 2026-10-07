-- Custom modules (organization-defined record types), web tabs and public web forms.
CREATE TABLE IF NOT EXISTS custom_modules (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,                 -- plural, e.g. "Service requests"
  singular       TEXT NOT NULL,                 -- e.g. "Service request"
  slug           TEXT NOT NULL,
  description    TEXT,
  fields         JSONB NOT NULL DEFAULT '[]',   -- [{ field_key, label, field_type, options, required, show_in_list, ... }]
  number_prefix  TEXT NOT NULL DEFAULT 'REC',
  next_number    INTEGER NOT NULL DEFAULT 1,
  show_in_nav    BOOLEAN NOT NULL DEFAULT TRUE,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS custom_records (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id   BIGINT NOT NULL REFERENCES custom_modules(id) ON DELETE CASCADE,
  number      TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL DEFAULT 'app',      -- app | web_form | api
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (module_id, number)
);
CREATE INDEX IF NOT EXISTS custom_records_module_idx ON custom_records (module_id, created_at DESC);

CREATE TABLE IF NOT EXISTS web_tabs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  open_mode   TEXT NOT NULL DEFAULT 'embed' CHECK (open_mode IN ('embed', 'new_tab')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS web_forms (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  token            TEXT NOT NULL UNIQUE,
  target           TEXT NOT NULL,                 -- 'customer' or 'module:<id>'
  title            TEXT,
  intro            TEXT,
  fields           JSONB NOT NULL DEFAULT '[]',   -- [{ key, label, required }]
  success_message  TEXT,
  notify_email     TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  submissions      INTEGER NOT NULL DEFAULT 0,
  last_submitted_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing roles: everyone may view, add and edit custom module records; managers may also delete and export.
UPDATE roles SET permissions = permissions || jsonb_build_object('custom_modules',
  CASE WHEN name = 'Manager' THEN '["view","create","edit","delete","export"]'::jsonb ELSE '["view","create","edit"]'::jsonb END)
 WHERE NOT is_admin AND NOT (permissions ? 'custom_modules');

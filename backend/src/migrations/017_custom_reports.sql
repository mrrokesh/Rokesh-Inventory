-- Reports built with the custom report builder (private to their creator, or shared with the team).
CREATE TABLE IF NOT EXISTS custom_reports (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  source       TEXT NOT NULL,
  definition   JSONB NOT NULL DEFAULT '{}',   -- { columns, filters, group_by, sort }
  shared       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_reports_org_idx ON custom_reports (org_id);

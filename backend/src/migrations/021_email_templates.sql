-- Email notification templates: the default subject and message used when a document is emailed.
CREATE TABLE IF NOT EXISTS email_templates (
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, doc_type)
);

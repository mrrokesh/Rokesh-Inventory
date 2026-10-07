-- Text messages sent through the organization's SMS provider (Twilio or MSG91).
CREATE TABLE IF NOT EXISTS sms_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider     TEXT,
  to_number    TEXT NOT NULL,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error        TEXT,
  provider_id  TEXT,
  entity_type  TEXT,
  entity_id    BIGINT,
  sent_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_log_org_idx ON sms_log (org_id, created_at DESC);

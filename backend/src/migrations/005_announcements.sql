-- Org announcements (Zoho-style product notices) + per-user read state.

CREATE TABLE IF NOT EXISTS announcements (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS announcements_org_status_idx ON announcements (org_id, status, published_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

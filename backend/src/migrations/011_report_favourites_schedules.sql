-- Favourite reports (per user) and reports emailed on a schedule.
CREATE TABLE IF NOT EXISTS report_favourites (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_key  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, report_key)
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  report_key    TEXT NOT NULL,
  period        TEXT NOT NULL DEFAULT 'this_month',
  warehouse_id  BIGINT REFERENCES warehouses(id) ON DELETE SET NULL,
  frequency     TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  weekday       INTEGER CHECK (weekday BETWEEN 0 AND 6),          -- 0 = Sunday (weekly)
  day_of_month  INTEGER CHECK (day_of_month BETWEEN 1 AND 28),    -- monthly
  hour          INTEGER NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
  recipients    TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  next_run_at   TIMESTAMPTZ NOT NULL,
  last_run_at   TIMESTAMPTZ,
  last_status   TEXT,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON report_schedules (next_run_at) WHERE is_active;

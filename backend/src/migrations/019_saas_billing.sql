-- SaaS billing fields + plan pricing for platform Razorpay subscriptions.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS price_monthly NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT;

UPDATE plans SET price_monthly = 999  WHERE code = 'starter'  AND price_monthly = 0;
UPDATE plans SET price_monthly = 2499 WHERE code = 'growth'   AND price_monthly = 0;
UPDATE plans SET price_monthly = 5999 WHERE code = 'business' AND price_monthly = 0;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none', 'pending', 'active', 'past_due', 'cancelled')),
  ADD COLUMN IF NOT EXISTS paid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS last_payment_id TEXT;

CREATE TABLE IF NOT EXISTS platform_payments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id         BIGINT REFERENCES plans(id) ON DELETE SET NULL,
  amount          NUMERIC(18,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'INR',
  razorpay_payment_id TEXT,
  razorpay_link_id    TEXT,
  status          TEXT NOT NULL DEFAULT 'created',
  meta            JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_payments_org_idx ON platform_payments (org_id, created_at DESC);

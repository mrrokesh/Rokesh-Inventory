-- Vendor portal: a vendor's answer to a purchase order.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_response TEXT CHECK (vendor_response IN ('accepted', 'declined'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_response_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS vendor_response_note TEXT;

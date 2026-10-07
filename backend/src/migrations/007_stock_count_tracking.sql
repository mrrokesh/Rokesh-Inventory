-- Serial numbers / batches entered on stock count lines (used when the count differs from stock).
ALTER TABLE stock_count_lines ADD COLUMN IF NOT EXISTS tracking JSONB;
ALTER TABLE inventory_adjustment_lines ADD COLUMN IF NOT EXISTS tracking JSONB;

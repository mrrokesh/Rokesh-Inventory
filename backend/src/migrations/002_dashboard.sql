-- Per-user dashboard widget layout: [{ "id": "low_stock", "size": "medium" }, ...]
ALTER TABLE users ADD COLUMN dashboard_layout JSONB;

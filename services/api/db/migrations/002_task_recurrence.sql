ALTER TABLE tasks ADD COLUMN type_label TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_interval INTEGER;
ALTER TABLE tasks ADD COLUMN recurrence_unit TEXT;
ALTER TABLE tasks ADD COLUMN reminder_offset_days INTEGER;
ALTER TABLE tasks ADD COLUMN auto_debit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_generated_at TEXT;

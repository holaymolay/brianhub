ALTER TABLE notices ADD COLUMN recurrence_rule_json TEXT;
ALTER TABLE notices ADD COLUMN recurrence_occurrence_count INTEGER NOT NULL DEFAULT 0;

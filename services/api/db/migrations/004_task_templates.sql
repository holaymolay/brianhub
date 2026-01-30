ALTER TABLE tasks ADD COLUMN template_id TEXT;
ALTER TABLE tasks ADD COLUMN template_state TEXT;
ALTER TABLE tasks ADD COLUMN template_event_date TEXT;
ALTER TABLE tasks ADD COLUMN template_lead_days INTEGER;
ALTER TABLE tasks ADD COLUMN template_defer_until TEXT;
ALTER TABLE tasks ADD COLUMN template_prompt_pending INTEGER NOT NULL DEFAULT 0;

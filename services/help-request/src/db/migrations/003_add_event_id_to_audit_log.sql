-- 003_add_event_id_to_audit_log.sql
-- Step 6: Add event_id for idempotency

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS event_id UUID UNIQUE;

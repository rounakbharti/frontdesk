-- 002_update_audit_log_schema.sql
-- Step 6: Generalize audit_log for centralized logging

-- 1. Remove foreign key constraint if it exists (making it polymorphic)
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_help_request_id_fkey;

-- 2. Rename help_request_id to entity_id to support multiple entity types
ALTER TABLE audit_log RENAME COLUMN help_request_id TO entity_id;

-- 3. Add entity_type to track what kind of record entity_id points to
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_type VARCHAR(255) DEFAULT 'help_request';

-- 4. Rename actor to actor_id for consistency with AuditEventSchema
ALTER TABLE audit_log RENAME COLUMN actor TO actor_id;

-- 5. Add index on entity_id and entity_type for faster filtering
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

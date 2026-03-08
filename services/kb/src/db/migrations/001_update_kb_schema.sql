-- 001_update_kb_schema.sql
-- Updates the knowledge_base table to support normalization, source tracking, and versioning.

-- 1. Add new columns if they don't exist
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS question_normalized TEXT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS answer TEXT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'supervisor';
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_help_request_id UUID;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS confidence_score FLOAT;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;

-- 2. Migrate existing data (if any)
UPDATE knowledge_base 
SET question_normalized = LOWER(TRIM(query)), 
    answer = resolution 
WHERE question_normalized IS NULL;

-- 3. Now make mandatory columns NOT NULL and add constraints
ALTER TABLE knowledge_base ALTER COLUMN question_normalized SET NOT NULL;
ALTER TABLE knowledge_base ALTER COLUMN answer SET NOT NULL;

-- 4. Unique constraint for normalization (idempotency)
ALTER TABLE knowledge_base DROP CONSTRAINT IF EXISTS unq_kb_question_normalized;
ALTER TABLE knowledge_base ADD CONSTRAINT unq_kb_question_normalized UNIQUE (question_normalized);

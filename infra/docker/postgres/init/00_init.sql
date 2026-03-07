-- ============================================================
-- Frontdesk AI — PostgreSQL Initialization
-- This runs once on first container start.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Enable pg_trgm for fuzzy text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Log that init ran
DO $$
BEGIN
  RAISE NOTICE 'Frontdesk AI — DB initialized at %', NOW();
END $$;

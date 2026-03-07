-- 001_initial_schema.sql
-- Created early to ensure extensions are ready just in case
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supervisors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'offline', -- online, offline, busy
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query TEXT NOT NULL,
    resolution TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_embeddings (
    knowledge_base_id UUID PRIMARY KEY REFERENCES knowledge_base(id) ON DELETE CASCADE,
    -- We store the vector as a JSON array since we're using ES for actual vector search
    -- but storing the raw vector in PG is good for backup or future pgvector migration.
    -- For this purely local setup, we'll search via Python FAISS locally or Elasticsearch dense_vector.
    vector JSONB NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS help_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID REFERENCES customers(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, routed_to_human, resolved
    priority VARCHAR(50) NOT NULL DEFAULT 'normal', -- normal, urgent
    issue_summary TEXT NOT NULL,
    resolution_notes TEXT,
    resolved_by UUID REFERENCES supervisors(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    -- Optimistic locking to prevent race conditions (e.g., Timeout worker vs Human)
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    help_request_id UUID REFERENCES help_requests(id) ON DELETE SET NULL,
    actor VARCHAR(255) NOT NULL, -- e.g., 'system', 'supervisor_id', 'timeout_worker'
    action VARCHAR(255) NOT NULL, -- e.g., 'created', 'routed', 'resolved', 'timeout_escalated'
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status);
CREATE INDEX IF NOT EXISTS idx_help_requests_customer_id ON help_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_help_request_id ON audit_log(help_request_id);

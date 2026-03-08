import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });
const { Client } = pg;

async function runMigrations() {
  const client = new Client({
    connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://frontdesk:frontdesk_secret@localhost:5432/frontdesk',
  });

  try {
    console.log('[kb] Connecting to database...');
    await client.connect();
    
    // Create migrations tracking table (shared prefix to avoid conflict)
    await client.query(`
      CREATE TABLE IF NOT EXISTS kb_schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).sort();

    for (const file of files) {
      if (!file.endsWith('.sql')) continue;

      const { rows } = await client.query(
        'SELECT version FROM kb_schema_migrations WHERE version = $1',
        [file]
      );

      if (rows.length === 0) {
        console.log(`[kb] Running migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO kb_schema_migrations (version) VALUES ($1)',
            [file]
          );
          await client.query('COMMIT');
          console.log(`[kb] Successfully applied: ${file}`);
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`[kb] Failed to apply migration ${file}:`, error);
          throw error;
        }
      } else {
        console.log(`[kb] Migration already applied: ${file}`);
      }
    }
  } catch (error) {
    console.error('[kb] Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations();
}

export { runMigrations };

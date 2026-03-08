import pg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env'), override: true });

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://frontdesk:frontdesk_secret@127.0.0.1:5434/frontdesk',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  process.stderr.write(`[kb] Postgres pool error: ${err.message}\n`);
});

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../../.env'), override: true });

export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://frontdesk:frontdesk_secret@127.0.0.1:5434/frontdesk',
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle pg client', err);
  process.exit(-1);
});

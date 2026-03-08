import { Kafka } from 'kafkajs';
import pg from 'pg';
import dotenv from 'dotenv';
import { resolve } from 'path';
import pino from 'pino';
import {
  KafkaTopics,
  AuditEventSchema,
} from '@frontdesk/types';

dotenv.config({ path: resolve(__dirname, '../../../.env'), override: true });

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// ── Postgres ──────────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://frontdesk:frontdesk_secret@127.0.0.1:5434/frontdesk',
  max: 5,
});

// ── Kafka ─────────────────────────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'audit-worker',
  brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || '127.0.0.1:9092').split(','),
});

const consumer = kafka.consumer({ groupId: 'audit-worker-group' });

// ── Core Logic ────────────────────────────────────────────────────────────────

async function run() {
  log.info('Audit worker starting — listening on audit_events');
  
  await consumer.connect();
  await consumer.subscribe({ 
    topic: KafkaTopics.AUDIT_EVENTS || 'audit.events', 
    fromBeginning: false 
  });

  await consumer.run({
    eachMessage: async ({ message, partition }) => {
      if (!message.value) return;

      const raw = message.value.toString();
      const offset = message.offset;
      log.debug({ partition, offset }, 'Received audit event');

      try {
        const event = AuditEventSchema.parse(JSON.parse(raw));
        const { entity_type, entity_id, action, actor_id, details } = event.payload;

        // Persist to Postgres audit_log (generic schema from migration 002/003)
        await pool.query(`
          INSERT INTO audit_log (
            entity_type, entity_id, action, actor_id, details, created_at, event_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (event_id) DO NOTHING
        `, [
          entity_type, 
          entity_id, 
          action, 
          actor_id || 'system', 
          JSON.stringify(details),
          event.meta.timestamp,
          event.meta.event_id
        ]);

        log.info({ entity_type, entity_id, action, event_id: event.meta.event_id }, 'Audit log persisted');

      } catch (err) {
        log.error({ err, offset, partition }, 'Failed to process audit event');
      }
    },
  });
}

run().catch(err => {
  log.error({ err }, 'Fatal error in audit-worker');
  process.exit(1);
});

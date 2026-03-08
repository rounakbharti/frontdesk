import { Kafka, Producer } from 'kafkajs';
import pg from 'pg';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { resolve } from 'path';
import pino from 'pino';
import {
  SupervisorAnsweredEventSchema,
  KafkaTopics,
  KbLearnEventSchema,
} from '@frontdesk/types';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

// ── Postgres ──────────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://frontdesk:frontdesk_secret@localhost:5432/frontdesk',
  max: 5,
});

// ── Kafka ─────────────────────────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'kb-indexer-worker',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const consumer = kafka.consumer({ groupId: 'kb-indexer-group' });
const producer: Producer = kafka.producer();

// ── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Upsert the supervisor answer into the knowledge_base table.
 * Returns the canonical KB entry UUID so it can be forwarded to Elasticsearch.
 */
async function upsertKbEntry(
  questionNormalized: string,
  answer: string,
  sourceHelpRequestId: string | null,
): Promise<string> {
  const result = await pool.query<{ id: string }>(`
    INSERT INTO knowledge_base (
      question_normalized, answer, source, source_help_request_id, active, version
    ) VALUES ($1, $2, 'supervisor', $3, true, 1)
    ON CONFLICT (question_normalized) DO UPDATE
      SET answer = EXCLUDED.answer,
          updated_at = NOW(),
          version = knowledge_base.version + 1
    RETURNING id
  `, [questionNormalized, answer, sourceHelpRequestId]);

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to upsert KB entry');
  }
  return row.id;
}

/**
 * Emit a kb.learn Kafka event so the KB service can index in Elasticsearch.
 */
async function emitKbLearnEvent(
  kbId: string,
  questionText: string,
  answerText: string,
  sourceHelpRequestId: string | null,
): Promise<void> {
  const event = {
    meta: {
      event_id: randomUUID(),
      event_version: '1.0' as const,
      source_service: 'kb-indexer',
      timestamp: new Date().toISOString(),
    },
    payload: {
      kb_candidate_id: kbId,
      question_text: questionText,
      answer_text: answerText,
      source_help_request_id: sourceHelpRequestId,
    },
  };

  // Validate before sending
  KbLearnEventSchema.parse(event);

  await producer.send({
    topic: KafkaTopics.KB_LEARN,
    messages: [{ key: kbId, value: JSON.stringify(event) }],
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: KafkaTopics.SUPERVISOR_ANSWERED, fromBeginning: false });

  log.info('kb-indexer worker started — listening on supervisor.answered');

  await consumer.run({
    eachMessage: async ({ message, partition }) => {
      if (!message.value) return;

      const raw = message.value.toString();
      const offset = message.offset;
      log.debug({ partition, offset }, 'Received supervisor.answered message');

      try {
        const event = SupervisorAnsweredEventSchema.parse(JSON.parse(raw));
        const { help_request_id, resolution_text } = event.payload;

        // Fetch the question text from Postgres using the help request id
        const hrResult = await pool.query<{ issue_summary: string }>(
          'SELECT issue_summary FROM help_requests WHERE id = $1',
          [help_request_id],
        );

        if (hrResult.rows.length === 0) {
          log.warn({ help_request_id }, 'help_request not found — skipping kb-indexer');
          return;
        }

        const row = hrResult.rows[0];
        if (!row) {
          log.warn({ help_request_id }, 'help_request found but no rows — skipping kb-indexer');
          return;
        }

        const questionText = row.issue_summary;
        const questionNormalized = questionText.toLowerCase().trim();

        // 1. Upsert into Postgres knowledge_base
        const kbId = await upsertKbEntry(questionNormalized, resolution_text, help_request_id);

        // 2. Emit kb.learn for the KB service to index into Elasticsearch
        await emitKbLearnEvent(kbId, questionText, resolution_text, help_request_id);

        log.info({ kbId, questionNormalized }, 'KB entry created and kb.learn emitted');

      } catch (err) {
        log.error({ err, raw }, 'Failed to process supervisor.answered — skipping');
      }
    },
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, async () => {
    log.info('Shutting down kb-indexer worker');
    await consumer.disconnect().catch(() => null);
    await producer.disconnect().catch(() => null);
    await pool.end().catch(() => null);
    process.exit(0);
  });
});

start().catch((err) => {
  log.error(err, 'kb-indexer worker failed to start');
  process.exit(1);
});

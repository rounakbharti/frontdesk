import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { pool } from './db';
import { ensureIndex, indexDocument } from './es';
import type { KbDocument } from './es';
import routes from './routes';
import { KafkaTopics, KbLearnEventSchema } from '@frontdesk/types';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const app = Fastify({ logger: true });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// ── Kafka consumer: kb.learn → Elasticsearch index ────────────────────────────
const kafka = new Kafka({
  clientId: 'kb-service',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});

const consumer = kafka.consumer({ groupId: 'kb-service-group' });

async function startKafkaConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: KafkaTopics.KB_LEARN, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        const raw: unknown = JSON.parse(message.value.toString());
        const event = KbLearnEventSchema.parse(raw);
        const { kb_candidate_id, question_text, answer_text, source_help_request_id } = event.payload;

        // Upsert into ES (Postgres write was already done by kb-indexer)
        const doc: KbDocument = {
          id: kb_candidate_id,
          question_normalized: question_text.toLowerCase().trim(),
          answer: answer_text,
          source: 'supervisor',
          confidence_score: event.payload.confidence_score || null,
          source_help_request_id,
          active: true,
          created_at: new Date().toISOString(),
        };
        await indexDocument(doc);
        app.log.info({ id: kb_candidate_id }, 'kb.learn event indexed into Elasticsearch');
      } catch (err) {
        app.log.error({ err }, 'Failed to process kb.learn Kafka message');
      }
    },
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  try {
    // 1. Ensure Elasticsearch index exists
    await ensureIndex();
    app.log.info('Elasticsearch KB index ready');

    // 2. Verify Postgres connectivity
    const client = await pool.connect();
    client.release();
    app.log.info('Postgres connection OK');

    // 3. Register HTTP routes
    await app.register(routes);

    // 4. Start Kafka consumer (background)
    startKafkaConsumer().catch((err) => {
      app.log.error({ err }, 'Kafka consumer failed to start');
    });

    // 5. Start HTTP server
    const port = parseInt(process.env.PORT_KB || '3004', 10);
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, async () => {
    await consumer.disconnect().catch(() => null);
    await app.close();
    await pool.end();
    process.exit(0);
  });
});

start();

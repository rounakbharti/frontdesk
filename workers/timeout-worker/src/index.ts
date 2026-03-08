import { resolve } from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: resolve(__dirname, '../../../.env'), override: true });

import { initTracing, metricsPlugin } from '@frontdesk/observability';
initTracing('timeout-worker');

import Fastify from 'fastify';
import { Kafka } from 'kafkajs';
import Redis from 'ioredis';
import pg from 'pg';
import { randomUUID } from 'crypto';
import pino from 'pino';
import {
  HelpRequestStatus,
  KafkaTopics,
  RedisKeys,
  HelpRequestTimedOutEventSchema,
} from '@frontdesk/types';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  }
});

// ── Connections ──────────────────────────────────────────────────────────────
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://frontdesk:frontdesk_secret@localhost:5432/frontdesk',
  max: 5,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const kafka = new Kafka({
  clientId: 'timeout-worker',
  brokers: (process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'localhost:9092').split(','),
});
const producer = kafka.producer();

// ── Business Logic ───────────────────────────────────────────────────────────

async function processTimeouts() {
  const now = Date.now();
  
  // 1. Get expired IDs from Redis ZSET (score <= now)
  const expiredIds = await redis.zrangebyscore(RedisKeys.PENDING_HELP_REQUESTS_ZSET, '-inf', now);
  
  if (expiredIds.length === 0) {
    return;
  }

  log.info({ count: expiredIds.length }, 'Found expired help requests');

  for (const hrId of expiredIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 2. Fetch current status and version (Optimistic locking)
      const { rows } = await client.query(
        'SELECT status, version, customer_id FROM help_requests WHERE id = $1 FOR UPDATE', 
        [hrId]
      );

      if (rows.length === 0) {
        log.warn({ hrId }, 'Expired ID in Redis not found in DB — cleaning up Redis');
        await redis.zrem(RedisKeys.PENDING_HELP_REQUESTS_ZSET, hrId);
        await client.query('ROLLBACK');
        continue;
      }

      const hr = rows[0];

      // If already resolved, just remove from Redis and move on
      if (hr.status !== HelpRequestStatus.PENDING) {
        log.debug({ hrId, status: hr.status }, 'Request already resolved/expired — cleaning up Redis');
        await redis.zrem(RedisKeys.PENDING_HELP_REQUESTS_ZSET, hrId);
        await client.query('ROLLBACK');
        continue;
      }

      // 3. Update status to UNRESOLVED
      const updateResult = await client.query(`
        UPDATE help_requests 
        SET status = $1, updated_at = NOW(), version = version + 1
        WHERE id = $2 AND version = $3
        RETURNING id
      `, [HelpRequestStatus.UNRESOLVED, hrId, hr.version]);

      if (updateResult.rowCount === 0) {
        log.warn({ hrId }, 'Concurrent update during timeout processing');
        await client.query('ROLLBACK');
        continue;
      }

      // 4. Audit Log (internal till audit-worker is ready)
      await client.query(`
        INSERT INTO audit_log (help_request_id, actor, action, details)
        VALUES ($1, $2, $3, $4)
      `, [hrId, 'timeout-worker', 'timed_out', JSON.stringify({ reason: 'supervisor_timeout' })]);

      await client.query('COMMIT');

      // 5. Emit Kafka Event
      const event = {
        meta: {
          event_id: randomUUID(),
          event_version: '1.0' as const,
          source_service: 'timeout-worker',
          timestamp: new Date().toISOString(),
        },
        payload: {
          help_request_id: hrId,
          customer_id: hr.customer_id,
          reason: 'supervisor_timeout' as const,
          expired_at: new Date().toISOString(),
        },
      };
      
      HelpRequestTimedOutEventSchema.parse(event);

      await producer.send({
        topic: KafkaTopics.HELP_REQUEST_TIMED_OUT,
        messages: [{ key: hrId, value: JSON.stringify(event) }],
      });

      // 6. Final Redis removal
      await redis.zrem(RedisKeys.PENDING_HELP_REQUESTS_ZSET, hrId);
      
      log.info({ hrId }, 'Successfully expired help request');

    } catch (err) {
      await client.query('ROLLBACK');
      log.error({ err, hrId }, 'Error processing timeout for help request');
    } finally {
      client.release();
    }
  }
}

async function run() {
  log.info('Timeout worker starting...');
  await producer.connect();

  // Start minimal metrics server for Prometheus
  const metricsApp = Fastify();
  await metricsApp.register(metricsPlugin);
  await metricsApp.listen({ port: 4007, host: '0.0.0.0' });
  log.info('Metrics server listening on port 4007');

  // Polling loop
  const TICK_MS = 5000;
  
  const poll = async () => {
    try {
      await processTimeouts();
    } catch (err) {
      log.error({ err }, 'Error in timeout polling tick');
    } finally {
      setTimeout(poll, TICK_MS);
    }
  };

  poll();
}

run().catch(err => {
  log.error({ err }, 'Fatal error in timeout-worker');
  process.exit(1);
});

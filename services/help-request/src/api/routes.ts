import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pool } from '../db';
import { redis } from '../redis';
import { producer } from '../kafka';
import { 
  HelpRequestStatus,
  KafkaTopics,
  RedisKeys,
  ResolutionSource,
} from '@frontdesk/types';
import type {
  CreateHelpRequestBody,
  ResolveHelpRequestBody
} from '@frontdesk/types';

export default async function routes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get('/health', async () => {
    return { status: 'ok', service: 'help-request' };
  });

  server.post('/help-requests', {
    schema: {
      body: z.object({
        customer_id: z.string().uuid(),
        call_session_id: z.string().min(1),
        question_text: z.string().min(1),
        agent_confidence: z.number().min(0).max(1),
        agent_answer: z.string().nullable().default(null)
      }),
      response: {
        201: z.object({ success: z.boolean(), id: z.string() })
      }
    }
  }, async (request, reply) => {
    const { customer_id, call_session_id, question_text, agent_confidence } = request.body as CreateHelpRequestBody;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert help request
      const ttlMinutes = parseInt(process.env.TIMEOUT_MINUTES || '5', 10);
      const ttlExpiresAt = new Date(Date.now() + ttlMinutes * 60000);

      const hrResult = await client.query(`
        INSERT INTO help_requests (
          customer_id, status, issue_summary, version, created_at, updated_at
        ) VALUES ($1, $2, $3, 1, NOW(), NOW())
        RETURNING id
      `, [customer_id, HelpRequestStatus.PENDING, question_text]);
      
      const hrId = hrResult.rows[0].id;

      // 2. Audit log
      await client.query(`
        INSERT INTO audit_log (help_request_id, actor, action, details)
        VALUES ($1, $2, $3, $4)
      `, [hrId, 'api', 'created', JSON.stringify({ call_session_id, agent_confidence })]);

      await client.query('COMMIT');

      // 3. Kafka event
      const eventPayload = {
        meta: {
          event_id: crypto.randomUUID(),
          event_version: '1.0',
          source_service: 'help-request',
          timestamp: new Date().toISOString()
        },
        payload: {
          help_request_id: hrId,
          customer_id,
          call_session_id,
          question_text,
          agent_confidence,
          ttl_expires_at: ttlExpiresAt.toISOString()
        }
      };

      // Best effort Kafka publish
      producer.send({
        topic: KafkaTopics.HELP_REQUEST_CREATED,
        messages: [{ key: hrId, value: JSON.stringify(eventPayload) }]
      }).catch((err: unknown) => request.log.error({ err }, 'Kafka send failed'));

      // 4. Redis TTL tracking (Sort by expiry timestamp)
      const score = ttlExpiresAt.getTime();
      await redis.zadd(RedisKeys.PENDING_HELP_REQUESTS_ZSET, score, hrId);

      return reply.code(201).send({ success: true, id: hrId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  server.post('/help-requests/:id/resolve', {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        resolution_text: z.string().min(1),
        supervisor_id: z.string().uuid()
      }),
      response: {
        200: z.object({ success: z.boolean() }),
        400: z.object({ error: z.string() })
      }
    }
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { resolution_text, supervisor_id } = request.body as ResolveHelpRequestBody;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Fetch current version (optimistic locking)
      const { rows } = await client.query('SELECT status, version, customer_id FROM help_requests WHERE id = $1 FOR UPDATE', [id]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Help request not found' });
      }

      const hr = rows[0];
      if (hr.status !== HelpRequestStatus.PENDING && hr.status !== HelpRequestStatus.UNRESOLVED) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Help request already resolved' });
      }

      // 2. Update status
      const updateResult = await client.query(`
        UPDATE help_requests 
        SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $4 AND version = $5
        RETURNING id
      `, [HelpRequestStatus.RESOLVED, resolution_text, supervisor_id, id, hr.version]);

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Concurrent update detected. Try again.' });
      }

      // 3. Audit log
      await client.query(`
        INSERT INTO audit_log (help_request_id, actor, action, details)
        VALUES ($1, $2, $3, $4)
      `, [id, supervisor_id, 'resolved', JSON.stringify({ resolution_text, source: ResolutionSource.SUPERVISOR })]);

      // We need caller_phone for the event. Let's get it from customer
      const custResult = await client.query('SELECT phone FROM customers WHERE id = $1', [hr.customer_id]);
      const caller_phone = custResult.rows[0]?.phone || 'unknown';

      await client.query('COMMIT');

      // 4. Redis cleanup
      await redis.zrem(RedisKeys.PENDING_HELP_REQUESTS_ZSET, id);

      // 5. Kafka events
      const eventPayload = {
        meta: {
          event_id: crypto.randomUUID(),
          event_version: '1.0',
          source_service: 'help-request',
          timestamp: new Date().toISOString()
        },
        payload: {
          help_request_id: id,
          resolution_text,
          supervisor_id,
          caller_phone
        }
      };

      // We emit both RESOLVED and SUPERVISOR_ANSWERED 
      // (supervisor.answered triggers KB indexing worker)
      producer.sendBatch({
        topicMessages: [
          {
            topic: KafkaTopics.HELP_REQUEST_RESOLVED,
            messages: [{ key: id, value: JSON.stringify(eventPayload) }]
          },
          {
            topic: KafkaTopics.SUPERVISOR_ANSWERED,
            messages: [{ key: id, value: JSON.stringify(eventPayload) }]
          }
        ]
      }).catch(err => request.log.error('Kafka send failed', err));

      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  server.get('/help-requests/pending', {
    schema: {
      response: {
        200: z.object({ help_requests: z.array(z.record(z.unknown())) })
      }
    }
  }, async () => {
    // List for Supervisor UI
    const { rows } = await pool.query(`
      SELECT hr.*, c.name as customer_name, c.phone as customer_phone
      FROM help_requests hr
      LEFT JOIN customers c ON hr.customer_id = c.id
      WHERE hr.status = $1
      ORDER BY hr.created_at ASC
      LIMIT 100
    `, [HelpRequestStatus.PENDING]);

    return { help_requests: rows };
  });
}

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pool } from './db';
import { indexDocument, searchKb, KbDocument } from './es';

export default async function routes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // ── Health ────────────────────────────────────────────────
  server.get('/health', async () => {
    return { status: 'ok', service: 'kb' };
  });

  // ── GET /kb/search ────────────────────────────────────────
  // Full-text BM25 search over indexed KB entries via Elasticsearch.
  server.get('/kb/search', {
    schema: {
      querystring: z.object({
        q: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(20).default(5),
      }),
      response: {
        200: z.object({
          results: z.array(z.object({
            id: z.string(),
            score: z.number(),
            question_normalized: z.string(),
            answer: z.string(),
            confidence_score: z.number().nullable(),
            source: z.string(),
          })),
        }),
      },
    },
  }, async (request) => {
    const { q, limit } = request.query as { q: string; limit: number };
    const hits = await searchKb(q, limit);
    return {
      results: hits.map((h) => ({
        id: h.id,
        score: h.score,
        question_normalized: h.source.question_normalized,
        answer: h.source.answer,
        confidence_score: h.source.confidence_score,
        source: h.source.source,
      })),
    };
  });

  // ── POST /kb/learn ────────────────────────────────────────
  // Persist a new KB entry to Postgres AND index it into Elasticsearch.
  // Called by: kb-indexer worker after receiving supervisor.answered event.
  server.post('/kb/learn', {
    schema: {
      body: z.object({
        question_text: z.string().min(1),
        answer_text: z.string().min(1),
        source: z.string().default('supervisor'),
        source_help_request_id: z.string().uuid().nullable().default(null),
        confidence_score: z.number().min(0).max(1).nullable().default(null),
      }),
      response: {
        201: z.object({ success: z.boolean(), id: z.string() }),
      },
    },
  }, async (request, reply) => {
    const { question_text, answer_text, source, source_help_request_id, confidence_score } = request.body as {
      question_text: string;
      answer_text: string;
      source: string;
      source_help_request_id: string | null;
      confidence_score: number | null;
    };

    // 1. Normalize question (lowercase + trim for consistent indexing)
    const question_normalized = question_text.toLowerCase().trim();

    // 2. Persist to Postgres (idempotent — same question_normalized won't duplicate)
    const result = await pool.query<{ id: string }>(`
      INSERT INTO knowledge_base (
        question_normalized, answer, source, source_help_request_id, confidence_score, active, version
      ) VALUES ($1, $2, $3, $4, $5, true, 1)
      ON CONFLICT (question_normalized) DO UPDATE
        SET answer = EXCLUDED.answer,
            confidence_score = EXCLUDED.confidence_score,
            version = knowledge_base.version + 1,
            updated_at = NOW()
      RETURNING id
    `, [question_normalized, answer_text, source, source_help_request_id, confidence_score]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to persist KB entry to database');
    }
    const id = row.id;

    // 3. Index into Elasticsearch
    const doc: KbDocument = {
      id,
      question_normalized,
      answer: answer_text,
      source,
      confidence_score,
      source_help_request_id,
      active: true,
      created_at: new Date().toISOString(),
    };
    await indexDocument(doc);

    app.log.info({ id, question_normalized }, 'KB entry indexed');
    return reply.code(201).send({ success: true, id });
  });
}

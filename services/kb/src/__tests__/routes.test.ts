import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import routes from '../routes';

// ── Mock Elasticsearch and Postgres so tests run without infra ────────────────
jest.mock('../es', () => ({
  ensureIndex: jest.fn().mockResolvedValue(undefined),
  indexDocument: jest.fn().mockResolvedValue(undefined),
  searchKb: jest.fn().mockResolvedValue([
    {
      id: 'test-kb-id-1',
      score: 1.5,
      source: {
        id: 'test-kb-id-1',
        question_normalized: 'what is the cancellation policy',
        answer: 'You can cancel within 24 hours for a full refund.',
        source: 'supervisor',
        confidence_score: 0.92,
        source_help_request_id: null,
        active: true,
        created_at: '2024-01-01T00:00:00.000Z',
      },
    },
  ]),
}));

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [{ id: 'new-kb-id-123' }] }),
    connect: jest.fn().mockResolvedValue({ release: jest.fn() }),
    end: jest.fn().mockResolvedValue(undefined),
  },
}));

function buildApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(routes);
  return app;
}

describe('KB Service API', () => {
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok', service: 'kb' });
  });

  it('GET /kb/search returns results array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/kb/search?q=cancellation+policy',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      id: 'test-kb-id-1',
      score: 1.5,
      answer: 'You can cancel within 24 hours for a full refund.',
    });
  });

  it('GET /kb/search with empty q returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/kb/search?q=',
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /kb/learn creates a new entry and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/kb/learn',
      payload: {
        question_text: 'What is the cancellation policy?',
        answer_text: 'You can cancel within 24 hours for a full refund.',
        source: 'supervisor',
        source_help_request_id: null,
        confidence_score: 0.95,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('string');
  });
});

import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import routes from '../routes';

// Mock dependencies
jest.mock('../../db', () => ({
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockImplementation((queryText: string) => {
        if (queryText.includes('INSERT INTO help_requests')) {
          return { rows: [{ id: '123e4567-e89b-12d3-a456-426614174000' }] };
        }
        if (queryText.includes('INSERT INTO audit_log')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: jest.fn()
    })
  }
}));

jest.mock('../../redis', () => ({
  redis: {
    zadd: jest.fn().mockResolvedValue(1),
    zrem: jest.fn().mockResolvedValue(1)
  }
}));

jest.mock('../../kafka', () => ({
  producer: {
    send: jest.fn().mockResolvedValue([{}]),
    sendBatch: jest.fn().mockResolvedValue([{}])
  },
  kafka: {}
}));

describe('Help Request Routes', () => {
  const fastify = Fastify();
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);
  fastify.register(routes);

  beforeAll(async () => {
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('GET /health returns ok', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'help-request' });
  });

  it('POST /help-requests creates an HR and returns 201', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/help-requests',
      payload: {
        customer_id: '123e4567-e89b-12d3-a456-426614174000',
        call_session_id: 'session-xyz',
        question_text: 'Help me reset my password',
        agent_confidence: 0.3,
        agent_answer: null
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('POST /help-requests/:id/resolve fails if body is empty / invalid', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/help-requests/123e4567-e89b-12d3-a456-426614174000/resolve',
      payload: {
        // missing required fields
      }
    });

    expect(response.statusCode).toBe(400); // Zod validation fails
  });
});

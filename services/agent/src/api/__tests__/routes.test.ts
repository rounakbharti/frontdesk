import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import routes from '../routes';
import { nluBreaker } from '../../nlu/client';
import { searchKnowledgeBase } from '../../kb/client';

jest.mock('../../nlu/client', () => ({
  nluBreaker: {
    fire: jest.fn()
  }
}));

jest.mock('../../kb/client', () => ({
  searchKnowledgeBase: jest.fn().mockResolvedValue([])
}));

global.fetch = jest.fn();

describe('Agent Service Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HELP_REQUEST_API_URL = 'http://localhost:3002';
    process.env.NLU_MODE = 'mock';

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    await app.register(routes);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /health returns 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health'
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'agent' });
  });

  it('POST /agent/call-events - Auto resolves on high confidence', async () => {
    (nluBreaker.fire as jest.Mock).mockResolvedValueOnce({
      answer: "This is the NLU answer.",
      confidence: 0.95,
      sources: []
    });

    const payload = {
      session_id: 'sess-123',
      caller_id: '+15551234567',
      transcript: 'Reset my password'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/agent/call-events',
      payload
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.action).toBe('auto_resolved');
    expect(data.nlu_confidence).toBe(0.95);
    expect(data.message).toBe("This is the NLU answer.");
    
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POST /agent/call-events - Routes to human on low confidence', async () => {
    (nluBreaker.fire as jest.Mock).mockResolvedValueOnce({
      answer: "I am not sure.",
      confidence: 0.40,
      sources: []
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '123e4567-e89b-12d3-a456-426614174000' })
    });

    const payload = {
      session_id: 'sess-123',
      caller_id: '+15551234567',
      transcript: 'A very complex question'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/agent/call-events',
      payload
    });

    // Log the JSON if it fails so we can see the internal Fastify error
    if (response.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.log('Low confidence Error:', response.json());
    }
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.action).toBe('routed_to_supervisors');
    expect(data.nlu_confidence).toBe(0.40);
    expect(data.help_request_id).toBe('123e4567-e89b-12d3-a456-426614174000');

    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3002/help-requests', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('A very complex question')
    }));
  });

  it('POST /agent/call-events - Auto-resolves via KB on low NLU confidence but high KB match', async () => {
    // 1. NLU returns low confidence
    (nluBreaker.fire as jest.Mock).mockResolvedValueOnce({
      answer: "I am not sure.",
      confidence: 0.40,
      sources: []
    });

    // 2. KB returns high score match
    (searchKnowledgeBase as jest.Mock).mockResolvedValueOnce([
      { id: 'kb-1', score: 12.0, answer: 'Answer from KB' }
    ]);

    const payload = {
      session_id: 'sess-kb',
      caller_id: '+15551234567',
      transcript: 'Known question'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/agent/call-events',
      payload
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.action).toBe('auto_resolved');
    expect(data.nlu_confidence).toBe(0.9); // The artificial score we set
    expect(data.message).toBe('Answer from KB');
    
    // Should NOT have called help-request service
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POST /agent/call-events - Utilizes fallback if NLU breaker fails completely', async () => {
    // Simulate Circuit Breaker rejection (or catastrophic NLU timeout)
    (nluBreaker.fire as jest.Mock).mockRejectedValueOnce(new Error('Breaker open'));

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '999e4567-e89b-12d3-a456-426614174999' })
    });

    const payload = {
      session_id: 'sess-999',
      caller_id: '+15551234567',
      transcript: 'Anything'
    };

    const response = await app.inject({
      method: 'POST',
      url: '/agent/call-events',
      payload
    });

    if (response.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.log('Fallback Error:', response.json());
    }
    expect(response.statusCode).toBe(200);
    const data = response.json();
    
    // Confidence is 0 because breaker failed, therefore it routes to supervisors
    expect(data.action).toBe('routed_to_supervisors');
    expect(data.nlu_confidence).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(data.message).toContain('human supervisor');
  });
});

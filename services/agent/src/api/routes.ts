import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { nluBreaker } from '../nlu/client';
import { searchKnowledgeBase } from '../kb/client';
import { 
  CallEventPayloadSchema, 
  NluMode 
} from '@frontdesk/types';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env'), override: true });

// The routing threshold dictates whether we automatically answer the user or route them to a human.
// Per architecture: >0.85 auto-resolve, otherwise human.
const CONFIDENCE_THRESHOLD = 0.85;
const helpRequestServiceUrl = process.env.HELP_REQUEST_API_URL || 'http://localhost:3002';
const nluMode = process.env.NLU_MODE || NluMode.MOCK;

export default async function routes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get('/health', async () => {
    return { status: 'ok', service: 'agent' };
  });

  server.post('/agent/call-events', {
    schema: {
      body: CallEventPayloadSchema,
      response: {
        200: z.object({
          action: z.enum(['auto_resolved', 'routed_to_supervisors']),
          nlu_confidence: z.number(),
          help_request_id: z.string().uuid().optional(),
          message: z.string()
        }),
        500: z.object({ error: z.string() })
      }
    }
  }, async (request, reply) => {
    const { session_id, caller_id, transcript } = request.body;

    // 1. Send query to NLU via Circuit Breaker
    let nluResponse;
    try {
      // opossum's fire() triggers the circuit breaker logic
      nluResponse = await nluBreaker.fire(transcript, nluMode) as {
        answer: string;
        confidence: number;
        sources: string[];
      };
    } catch (err: unknown) {
      request.log.error({ err }, 'NLU breaker completely failed, utilizing safe zero-confidence fallback');
      nluResponse = {
        answer: "Our automated system is currently analyzing your request. We will connect you to a human agent.",
        confidence: 0,
        sources: []
      };
    }

    const { confidence, answer } = nluResponse;

    // 2. Evaluate routing threshold
    if (confidence >= CONFIDENCE_THRESHOLD) {
      // Agent is highly confident. We synthesize the audio to the caller immediately.
      request.log.info({ session_id, caller_id, confidence }, 'High NLU confidence (>0.85). Auto-resolving query.');
      
      return reply.code(200).send({
        action: 'auto_resolved',
        nlu_confidence: confidence,
        message: answer
      });
    }

    // 3. Low confidence? Try KB search (Keyword/BM25) as a fallback
    // This allows auto-learned answers to be used even if the model isn't "sure" semantically.
    request.log.info({ session_id, transcript }, 'Low NLU confidence. Checking Knowledge Base fallback...');
    const kbResults = await searchKnowledgeBase(transcript);
    
    // threshold for BM25 score varies, but a score > 10 is usually a strong keyword match
    const bestKbMatch = kbResults[0];
    if (bestKbMatch && bestKbMatch.score > 10.0) {
      request.log.info({ kb_id: bestKbMatch.id, score: bestKbMatch.score }, 'Found strong KB match. Auto-resolving.');
      return reply.code(200).send({
        action: 'auto_resolved',
        nlu_confidence: 0.9, // Artificial confidence for KB matches
        message: bestKbMatch.answer
      });
    }

    // 4. Still nothing? Route to human supervisor queue
    request.log.info({ session_id, caller_id, confidence }, 'No reliable answer found. Routing to supervisors.');

    try {
      // We must call the Help Request Service to create a pending ticket
      const hrResponse = await fetch(`${helpRequestServiceUrl}/help-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: '123e4567-e89b-12d3-a456-426614174000', // Mock customer ID for sprint 1
          call_session_id: session_id,
          question_text: transcript,
          agent_confidence: confidence,
          agent_answer: answer
        })
      });

      if (!hrResponse.ok) {
        throw new Error(`Help request service returned ${hrResponse.status}`);
      }

      const hrData = await hrResponse.json();

      return reply.code(200).send({
        action: 'routed_to_supervisors',
        nlu_confidence: confidence,
        help_request_id: hrData.id,
        message: "I am routing you to a human supervisor who will assist you shortly."
      });
    } catch (err: unknown) {
      request.log.error({ err }, 'Failed to communicate with Help Request service');
      return reply.code(500).send({ error: 'Failed to create help request ticket' });
    }

  });
}

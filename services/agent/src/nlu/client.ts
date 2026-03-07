import axios from 'axios';
import CircuitBreaker from 'opossum';
import 'dotenv/config';

const nluUrl = process.env.NLU_API_URL || 'http://localhost:8000/nlu/query';

async function callNlu(query: string, mode: string) {
  const response = await axios.post(nluUrl, {
    query,
    mode
  }, { timeout: 3000 }); // strict 3 second timeout for NLU
  
  return response.data; // { answer, confidence, sources, mode, latency_ms }
}

const breakerOptions = {
  timeout: 3000, // Time in ms before a request fails
  errorThresholdPercentage: 50, // When 50% of requests fail, trip circuit
  resetTimeout: 10000 // After 10s, try one request to see if NLU recovered
};

export const nluBreaker = new CircuitBreaker(callNlu, breakerOptions);

nluBreaker.fallback(() => {
  // Deterministic fallback if NLU goes down permanently or hits breaker
  return {
    answer: "Our automated system is currently analyzing your request. We will connect you to a human agent.",
    confidence: 0,
    sources: [],
    mode: "mock_fallback"
  };
});

nluBreaker.on('open', () => console.warn('NLU Circuit Breaker OPENED'));
nluBreaker.on('halfOpen', () => console.info('NLU Circuit Breaker HALF-OPEN'));
nluBreaker.on('close', () => console.info('NLU Circuit Breaker CLOSED'));

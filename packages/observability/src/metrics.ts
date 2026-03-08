import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

// Global registry
const register = new Registry();

// Add default metrics (CPU, memory, etc.)
collectDefaultMetrics({ register });

// Standard HTTP metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

// Fastify plugin to expose /metrics
const metricsPluginInternal: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  // Middleware to track metrics
  fastify.addHook('onResponse', async (request, reply) => {
    if (request.routeOptions.config.url === '/metrics') return;

    const route = request.routeOptions.config.url || 'unknown';
    const statusCode = reply.statusCode.toString();
    const method = request.method;

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDurationSeconds.observe(
      { method, route, status_code: statusCode },
      reply.elapsedTime / 1000
    );
  });
};

export const metricsPlugin = fp(metricsPluginInternal);

export { register };

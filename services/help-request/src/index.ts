import Fastify from 'fastify';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { connectKafka, disconnectKafka } from './kafka';
import { pool } from './db';
import { redis } from './redis';
import routes from './api/routes';
import 'dotenv/config';

const port = parseInt(process.env.PORT || '3002', 10);
const host = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: true
});

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

async function start() {
  try {
    await fastify.register(cors, {
      origin: '*', // For development
    });

    await fastify.register(routes);

    await connectKafka();

    await fastify.listen({ port, host });
    fastify.log.info(`Help Request service listening on ${host}:${port}`);
    
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`Received ${signal}, shutting down...`);
    await fastify.close();
    await disconnectKafka();
    await redis.quit();
    await pool.end();
    process.exit(0);
  });
});

start();

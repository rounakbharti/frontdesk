import Fastify from 'fastify';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { connectKafka, disconnectKafka } from './kafka';
import routes from './api/routes';
import 'dotenv/config';

const port = parseInt(process.env.PORT || '3001', 10);
const host = process.env.HOST || '0.0.0.0';

const fastify = Fastify({ logger: true });

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

async function start() {
  try {
    await fastify.register(cors, { origin: '*' });
    await fastify.register(routes);

    await connectKafka();

    await fastify.listen({ port, host });
    fastify.log.info(`Agent service listening on ${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, async () => {
    fastify.log.info(`Received ${signal}, shutting down...`);
    await fastify.close();
    await disconnectKafka();
    process.exit(0);
  });
});

start();

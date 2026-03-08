import { resolve } from "path";
import dotenv from "dotenv";
dotenv.config({ path: resolve(__dirname, "../../../.env"), override: true });

import { initTracing, metricsPlugin } from "@frontdesk/observability";
initTracing("notification-service");

import Fastify from "fastify";
import { Kafka } from "kafkajs";
import { PassThrough } from "stream";
import {
  HelpRequestCreatedEventSchema,
  HelpRequestResolvedEventSchema,
  KafkaTopics,
} from "@frontdesk/types";

const fastify = Fastify({ logger: true });

// Configure Kafka Client
const kafka = new Kafka({
  clientId: "notification-service",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
});

const consumer = kafka.consumer({ groupId: "notification-group" });

// Active SSE Connections
const clients = new Set<PassThrough>();

// SSE Endpoint — pushed to Next.js UI
fastify.get("/notifications/stream", (req, reply) => {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Access-Control-Allow-Origin", "*");

  const stream = new PassThrough();
  reply.send(stream);
  clients.add(stream);

  // Initial handshake
  stream.write("data: connected\n\n");

  req.raw.on("close", () => {
    fastify.log.info("Client disconnected from SSE");
    clients.delete(stream);
  });
});

// Broadcast a typed payload to all connected SSE clients
function broadcast(data: Record<string, unknown>): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

const start = async () => {
  try {
    // 1. Connect Kafka Consumer
    await consumer.connect();
    fastify.log.info("Notification service connected to Kafka");

    // 2. Subscribe to Help Request events
    await consumer.subscribe({ topic: KafkaTopics.HELP_REQUEST_CREATED, fromBeginning: false });
    await consumer.subscribe({ topic: KafkaTopics.HELP_REQUEST_RESOLVED, fromBeginning: false });

    // 3. Consume Kafka messages, validate, then broadcast over SSE
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;

        try {
          const raw: unknown = JSON.parse(message.value.toString());

          // Validate against the appropriate schema
          const schema =
            topic === KafkaTopics.HELP_REQUEST_CREATED
              ? HelpRequestCreatedEventSchema
              : HelpRequestResolvedEventSchema;

          const event = schema.parse(raw);

          fastify.log.info({ topic }, "Broadcasting Kafka event over SSE");
          broadcast({ type: topic, data: event });

        } catch (err) {
          fastify.log.error(
            { err, raw: message.value.toString() },
            "Failed to process Kafka message — skipping"
          );
        }
      },
    });

    // 4. Start Fastify SSE server
    const port = parseInt(process.env.PORT_NOTIFICATION || "3003", 10);
    await fastify.register(metricsPlugin);
    await fastify.listen({ port, host: "0.0.0.0" });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, async () => {
    await consumer.disconnect();
    await fastify.close();
    process.exit(0);
  });
});

start();

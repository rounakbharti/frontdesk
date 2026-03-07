import { Kafka } from 'kafkajs';
import 'dotenv/config';

export const kafka = new Kafka({
  clientId: 'agent-service',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

export const producer = kafka.producer();

export async function connectKafka() {
  await producer.connect();
  // eslint-disable-next-line no-console
  console.log('Kafka producer connected in agent service');
}

export async function disconnectKafka() {
  await producer.disconnect();
}

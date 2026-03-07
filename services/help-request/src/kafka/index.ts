import { Kafka } from 'kafkajs';
import 'dotenv/config';

export const kafka = new Kafka({
  clientId: 'help-request-service',
  brokers: [process.env.KAFKA_BROKERS || 'localhost:9092'],
});

export const producer = kafka.producer();

export async function connectKafka() {
  await producer.connect();
  // eslint-disable-next-line no-console
  console.log('Kafka producer connected.');
}

export async function disconnectKafka() {
  await producer.disconnect();
}

import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
export const INDEX_NAME = 'frontdesk_kb';

export const esClient = new Client({ node: ES_URL });

/**
 * Ensure the Elasticsearch index exists with the correct mapping.
 * Safe to call multiple times — uses `create` with `ignore: [400]`.
 */
export async function ensureIndex(): Promise<void> {
  try {
    await esClient.indices.create({
      index: INDEX_NAME,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            analyzer: {
              kb_analyzer: {
                type: 'standard',
                stopwords: '_english_',
              },
            },
          },
        },
        mappings: {
          properties: {
            id: { type: 'keyword' },
            question_normalized: {
              type: 'text',
              analyzer: 'kb_analyzer',
              fields: {
                keyword: { type: 'keyword', ignore_above: 512 },
              },
            },
            answer: {
              type: 'text',
              analyzer: 'kb_analyzer',
            },
            source: { type: 'keyword' },
            confidence_score: { type: 'float' },
            source_help_request_id: { type: 'keyword' },
            active: { type: 'boolean' },
            created_at: { type: 'date' },
          },
        },
      },
    });
  } catch (err: unknown) {
    // 400 = index already exists — that's fine
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== 400) {
      throw err;
    }
  }
}

export interface KbDocument {
  id: string;
  question_normalized: string;
  answer: string;
  source: string;
  confidence_score: number | null;
  source_help_request_id: string | null;
  active: boolean;
  created_at: string;
}

/**
 * Index a KB document into Elasticsearch.
 */
export async function indexDocument(doc: KbDocument): Promise<void> {
  await esClient.index({
    index: INDEX_NAME,
    id: doc.id,
    document: doc,
    refresh: 'wait_for', // ensures reads reflect this write immediately in tests
  });
}

/**
 * Full-text search across the KB index.
 */
export async function searchKb(
  query: string,
  limit = 5,
): Promise<Array<{ id: string; score: number; source: KbDocument }>> {
  const resp = await esClient.search<KbDocument>({
    index: INDEX_NAME,
    size: limit,
    query: {
      bool: {
        must: {
          multi_match: {
            query,
            fields: ['question_normalized^2', 'answer'],
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        },
        filter: [{ term: { active: true } }],
      },
    },
  });

  return resp.hits.hits.map((hit) => ({
    id: hit._id ?? '',
    score: hit._score ?? 0,
    source: hit._source as KbDocument,
  }));
}

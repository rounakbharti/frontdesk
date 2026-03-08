import axios from 'axios';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../../../../.env') });

const KB_SERVICE_URL = process.env.KB_SERVICE_URL || 'http://localhost:3004';

export interface KbSearchResult {
  id: string;
  score: number;
  question_normalized: string;
  answer: string;
  confidence_score: number | null;
  source: string;
}

export async function searchKnowledgeBase(query: string): Promise<KbSearchResult[]> {
  try {
    const response = await axios.get(`${KB_SERVICE_URL}/kb/search`, {
      params: { q: query, limit: 3 },
    });
    return response.data.results;
  } catch (err) {
    console.error('[agent] KB search failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

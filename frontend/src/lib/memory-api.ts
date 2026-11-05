/**
 * Client for browsing and pruning memory: stored entries (/v1/memory/documents)
 * and facts learned from conversations (/v1/memory/facts).
 */
import { apiFetch } from './api';

export interface MemoryDocument {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  /** Unix seconds, or null if unknown. */
  created_at: number | null;
}

export interface LearnedFact {
  /** Position in the list; sent back with the text when forgetting. */
  index: number;
  text: string;
  source: string;
  created_at: number | null;
  trust: string;
  /** False for facts quarantined by the injection scanner (never used). */
  recallable: boolean;
}

async function fail(res: Response, fallback: string): Promise<never> {
  let detail = '';
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') detail = body.detail;
  } catch {
    // Non-JSON error body.
  }
  throw new Error(detail || `${fallback} (HTTP ${res.status})`);
}

export async function listMemoryDocuments(
  limit = 50,
  offset = 0,
): Promise<{ documents: MemoryDocument[]; total: number }> {
  const res = await apiFetch(`/v1/memory/documents?limit=${limit}&offset=${offset}`);
  if (!res.ok) return fail(res, 'Could not load memory');
  return res.json();
}

export async function deleteMemoryDocument(id: string): Promise<void> {
  const res = await apiFetch(`/v1/memory/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) return fail(res, 'Could not delete memory');
}

export async function listLearnedFacts(): Promise<{ enabled: boolean; facts: LearnedFact[] }> {
  const res = await apiFetch('/v1/memory/facts');
  if (!res.ok) return fail(res, 'Could not load learned facts');
  return res.json();
}

/** Forget a fact; the text guards against deleting a different one. */
export async function forgetFact(fact: Pick<LearnedFact, 'index' | 'text'>): Promise<void> {
  const res = await apiFetch('/v1/memory/facts/forget', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: fact.index, text: fact.text }),
  });
  if (!res.ok) return fail(res, 'Could not forget fact');
}

/** Case-insensitive substring filter on loaded items. */
export function filterByText<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => text(item).toLowerCase().includes(q));
}

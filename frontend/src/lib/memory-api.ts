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
  const body = await res.json();
  if (!Array.isArray(body?.documents)) throw new Error('Unexpected reply from the server while loading memory');
  return { documents: body.documents, total: Number.isFinite(body.total) ? body.total : body.documents.length };
}

export async function deleteMemoryDocument(id: string): Promise<void> {
  const res = await apiFetch(`/v1/memory/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) return fail(res, 'Could not delete memory');
}

export async function listLearnedFacts(): Promise<{ enabled: boolean; facts: LearnedFact[] }> {
  const res = await apiFetch('/v1/memory/facts');
  if (!res.ok) return fail(res, 'Could not load learned facts');
  const body = await res.json();
  if (!Array.isArray(body?.facts)) throw new Error('Unexpected reply from the server while loading learned facts');
  return { enabled: body.enabled !== false, facts: body.facts };
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

// ---- HELL memory controls (/v1/memory/settings, approve, remember, clear) --

export type LearningMode = 'off' | 'ask' | 'auto';

export interface MemorySettings {
  learning: LearningMode;
  use_in_replies: boolean;
  learning_available: boolean;
  facts: { total: number; pending: number; quarantined: number };
  documents: number;
  sensitive_policy: string;
}

function parseSettings(b: unknown): MemorySettings {
  const r = (b ?? {}) as Partial<MemorySettings>;
  const f = (r.facts ?? {}) as Partial<MemorySettings['facts']>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    learning: r.learning === 'ask' || r.learning === 'auto' ? r.learning : 'off',
    use_in_replies: r.use_in_replies !== false,
    learning_available: r.learning_available === true,
    facts: { total: n(f.total), pending: n(f.pending), quarantined: n(f.quarantined) },
    documents: n(r.documents),
    sensitive_policy: typeof r.sensitive_policy === 'string' ? r.sensitive_policy : '',
  };
}

export async function getMemorySettings(): Promise<MemorySettings> {
  const res = await apiFetch('/v1/memory/settings');
  if (!res.ok) return fail(res, 'Could not load memory settings');
  return parseSettings(await res.json());
}

export async function updateMemorySettings(patch: Partial<Pick<MemorySettings, 'learning' | 'use_in_replies'>>): Promise<MemorySettings> {
  const res = await apiFetch('/v1/memory/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return fail(res, 'Could not change memory settings');
  return parseSettings(await res.json());
}

export async function approveFact(fact: Pick<LearnedFact, 'index' | 'text'>): Promise<void> {
  const res = await apiFetch('/v1/memory/facts/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index: fact.index, text: fact.text }),
  });
  if (!res.ok) return fail(res, 'Could not approve');
}

/** Teach HELL a fact (trusted). Secrets are refused by the server. */
export async function rememberFact(text: string): Promise<'stored' | 'already_known'> {
  const res = await apiFetch('/v1/memory/facts/remember', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return fail(res, 'Could not remember that');
  const b = await res.json();
  return b?.status === 'already_known' ? 'already_known' : 'stored';
}

export async function clearLearnedFacts(): Promise<number> {
  const res = await apiFetch('/v1/memory/facts/clear', { method: 'POST' });
  if (!res.ok) return fail(res, 'Could not clear learned facts');
  return Number((await res.json())?.cleared) || 0;
}

export async function clearSavedMemory(): Promise<number> {
  const res = await apiFetch('/v1/memory/documents/clear', { method: 'POST' });
  if (!res.ok) return fail(res, 'Could not clear saved memory');
  return Number((await res.json())?.cleared) || 0;
}

// ---- Grouping & search (pure) ----------------------------------------------

export type FactCategory = 'preference' | 'project' | 'about' | 'other';

export const CATEGORY_LABELS: Record<FactCategory, string> = {
  preference: 'Preferences',
  project: 'Projects',
  about: 'About you',
  other: 'Other',
};

/** Rough grouping for browsing (keyword-based; it never changes what is stored). */
export function categorizeFact(text: string): FactCategory {
  const t = text.toLowerCase();
  if (/\b(prefer\w*|likes?|loves?|enjoys?|hates?|dislikes?|favou?rite|rather|always|never|wants? .* to be)\b/.test(t)) return 'preference';
  if (/\b(project|working on|building|builds?|develop\w*|repo\w*|app|startup|deadline|launch\w*|plan\w* to)\b/.test(t)) return 'project';
  if (/\b(name|lives?|age|born|works? (as|at)|job|family|daughter|son|wife|husband|partner|pet|dog|cat|speaks?|from)\b/.test(t)) return 'about';
  return 'other';
}

export interface ConversationHit {
  id: string;
  title: string;
  updatedAt: number;
  messages: number;
  /** A short excerpt around the first match (or the last message). */
  snippet: string;
}

/** Search local conversations by title and message text. */
export function searchConversations(
  conversations: { id: string; title: string; updatedAt: number; messages: { role: string; content: string }[] }[],
  query: string,
): ConversationHit[] {
  const q = query.trim().toLowerCase();
  const hits: ConversationHit[] = [];
  for (const c of conversations) {
    let snippet = '';
    if (q) {
      const inTitle = c.title.toLowerCase().includes(q);
      const msg = c.messages.find((m) => m.content.toLowerCase().includes(q));
      if (!inTitle && !msg) continue;
      if (msg) {
        const i = msg.content.toLowerCase().indexOf(q);
        const start = Math.max(0, i - 40);
        snippet = (start > 0 ? '…' : '') + msg.content.slice(start, i + q.length + 60).replace(/\s+/g, ' ').trim();
      }
    }
    if (!snippet) {
      const last = [...c.messages].reverse().find((m) => m.content.trim());
      snippet = last ? last.content.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    }
    hits.push({ id: c.id, title: c.title || 'Untitled', updatedAt: c.updatedAt, messages: c.messages.length, snippet });
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt);
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', '');
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage = undefined;
});

const json = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('memory management client', () => {
  it('pages through stored entries', async () => {
    fetchMock.mockResolvedValue(json({ documents: [], total: 0 }));
    const { listMemoryDocuments } = await import('./memory-api');
    await listMemoryDocuments(20, 40);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/v1/memory/documents?limit=20&offset=40');
  });

  it('deletes an entry by encoded id', async () => {
    fetchMock.mockResolvedValue(json(null, 204));
    const { deleteMemoryDocument } = await import('./memory-api');
    await deleteMemoryDocument('a b');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/v1/memory/documents/a%20b');
    expect(init?.method).toBe('DELETE');
  });

  it('forgets a fact by index and text', async () => {
    fetchMock.mockResolvedValue(json({ status: 'forgotten' }));
    const { forgetFact } = await import('./memory-api');
    await forgetFact({ index: 3, text: 'likes espresso' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/v1/memory/facts/forget');
    expect(JSON.parse(String(init?.body))).toEqual({ index: 3, text: 'likes espresso' });
  });

  it("surfaces the server's conflict message", async () => {
    fetchMock.mockResolvedValue(json({ detail: 'That fact changed or no longer exists' }, 409));
    const { forgetFact } = await import('./memory-api');
    await expect(forgetFact({ index: 0, text: 'x' })).rejects.toThrow('That fact changed');
  });

  it('sends the API key', async () => {
    localStorage.setItem('openjarvis-settings', JSON.stringify({ apiKey: 'k' }));
    fetchMock.mockResolvedValue(json({ enabled: true, facts: [] }));
    const { listLearnedFacts } = await import('./memory-api');
    await listLearnedFacts();
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('filters case-insensitively', async () => {
    const { filterByText } = await import('./memory-api');
    const items = ['Likes Espresso', 'Has a dog'];
    expect(filterByText(items, 'espresso', (s) => s)).toEqual(['Likes Espresso']);
    expect(filterByText(items, '  ', (s) => s)).toEqual(items);
  });
});

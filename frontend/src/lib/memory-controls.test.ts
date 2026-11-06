import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', '');
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});
afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('memory controls client', () => {
  it('parses settings defensively', async () => {
    fetchMock.mockResolvedValue(json({ learning: 'weird', facts: { pending: 2 } }));
    const { getMemorySettings } = await import('./memory-api');
    const s = await getMemorySettings();
    expect(s).toMatchObject({ learning: 'off', use_in_replies: true, learning_available: false, facts: { total: 0, pending: 2, quarantined: 0 } });
  });

  it('remember surfaces the secret refusal from the server', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'That looks like a password, key or card number. HELL never stores secrets.' }, 422));
    const { rememberFact } = await import('./memory-api');
    await expect(rememberFact('my pin is 1234')).rejects.toThrow(/never stores secrets/);
  });

  it('approve sends index + text', async () => {
    fetchMock.mockResolvedValue(json({ status: 'approved' }));
    const { approveFact } = await import('./memory-api');
    await approveFact({ index: 3, text: 'User prefers tea' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ index: 3, text: 'User prefers tea' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('/v1/memory/facts/approve');
  });
});

describe('grouping and search', () => {
  it('groups facts by kind', async () => {
    const { categorizeFact } = await import('./memory-api');
    expect(categorizeFact('User prefers dark mode')).toBe('preference');
    expect(categorizeFact('User is building a hologram app')).toBe('project');
    expect(categorizeFact("User's daughter is named Mia")).toBe('about');
    expect(categorizeFact('The sky was clear on Tuesday')).toBe('other');
  });

  it('searches chats by title and text, newest first, with a snippet', async () => {
    const { searchConversations } = await import('./memory-api');
    const convs = [
      { id: 'a', title: 'Trip plans', updatedAt: 1, messages: [{ role: 'user', content: 'Book a train to Lyon on Friday' }] },
      { id: 'b', title: 'Recipes', updatedAt: 5, messages: [{ role: 'user', content: 'How do I make pho?' }, { role: 'assistant', content: 'Start with the broth.' }] },
    ];
    expect(searchConversations(convs, '').map((h) => h.id)).toEqual(['b', 'a']);
    const hit = searchConversations(convs, 'lyon');
    expect(hit.map((h) => h.id)).toEqual(['a']);
    expect(hit[0].snippet).toContain('Lyon');
    expect(searchConversations(convs, 'recipes')[0].id).toBe('b');
    expect(searchConversations(convs, 'zzz')).toEqual([]);
  });
});

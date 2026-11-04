import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from './personal-api';

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

const ok = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('personal API client', () => {
  it('lists open tasks by default', async () => {
    fetchMock.mockResolvedValue(ok({ tasks: [{ id: 't1', title: 'x' }] }));
    const { listTasks } = await import('./personal-api');
    expect(await listTasks()).toEqual([{ id: 't1', title: 'x' }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/v1/personal/tasks?status=open');
  });

  it('sends JSON with the method and encodes ids', async () => {
    fetchMock.mockResolvedValue(ok({ id: 'a/b', done: true }));
    const { updateTask } = await import('./personal-api');
    await updateTask('a/b', { done: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/v1/personal/tasks/a%2Fb');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ done: true });
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends the saved API key as a Bearer token', async () => {
    localStorage.setItem('openjarvis-settings', JSON.stringify({ apiKey: 'k-123' }));
    fetchMock.mockResolvedValue(ok({ notes: [] }));
    const { listNotes } = await import('./personal-api');
    await listNotes('milk & eggs');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/v1/personal/notes?q=milk%20%26%20eggs');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k-123');
  });

  it('handles 204 on delete', async () => {
    fetchMock.mockResolvedValue(ok(null, 204));
    const { deleteNote } = await import('./personal-api');
    await expect(deleteNote('n1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('surfaces FastAPI validation messages', async () => {
    fetchMock.mockResolvedValue(
      ok({ detail: [{ msg: 'Value error, due must be a date like 2026-11-05' }] }, 422),
    );
    const { createTask } = await import('./personal-api');
    await expect(createTask({ title: 'x', due: 'soon' })).rejects.toThrow('due must be a date like 2026-11-05');
  });

  it('falls back to a status message for non-JSON errors', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const { listNotes } = await import('./personal-api');
    await expect(listNotes()).rejects.toThrow('Could not load notes (HTTP 500)');
  });
});

describe('task grouping and due labels', () => {
  const t = (id: string, due: string | null): Task => ({
    id, title: id, notes: '', due, priority: 0, done: false, created_at: 0, updated_at: 0, completed_at: null,
  });

  it('buckets by due date and drops empty groups', async () => {
    const { groupTasks } = await import('./personal-api');
    const groups = groupTasks(
      [t('old', '2026-11-01'), t('now', '2026-11-04'), t('soon', '2026-11-10'), t('free', null)],
      '2026-11-04',
    );
    expect(groups.map((g) => [g.key, g.tasks.map((x) => x.id)])).toEqual([
      ['overdue', ['old']],
      ['today', ['now']],
      ['upcoming', ['soon']],
      ['someday', ['free']],
    ]);
    expect(groupTasks([t('free', null)], '2026-11-04').map((g) => g.key)).toEqual(['someday']);
  });

  it('labels relative days', async () => {
    const { formatDue } = await import('./personal-api');
    expect(formatDue('2026-11-04', '2026-11-04')).toBe('Today');
    expect(formatDue('2026-11-05', '2026-11-04')).toBe('Tomorrow');
    expect(formatDue('2026-11-03', '2026-11-04')).toBe('Yesterday');
    expect(formatDue('2026-11-01', '2026-11-04')).toBe('3 days ago');
    // Long-overdue shows the date, not "9804 days ago".
    const longAgo = formatDue('2000-01-01', '2026-11-04');
    expect(longAgo).not.toMatch(/days ago/);
    expect(longAgo).toMatch(/2000/);
    // Across a DST change the day count must still be whole days.
    expect(formatDue('2026-03-30', '2026-03-28')).not.toBe('Tomorrow');
  });

  it('formats local dates without UTC drift', async () => {
    const { localISODate } = await import('./personal-api');
    expect(localISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

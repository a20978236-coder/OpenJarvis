import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
const events: string[] = [];

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
  events.length = 0;
  globalThis.fetch = fetchMock;
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  vi.stubGlobal('window', { dispatchEvent: (e: Event) => events.push(e.type) });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage = undefined;
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('session sign-in client', () => {
  it('reads sign-in status', async () => {
    fetchMock.mockResolvedValue(json({ auth_required: true, authenticated: false, via: null }));
    const { getSessionStatus } = await import('./session-api');
    expect(await getSessionStatus()).toEqual({ auth_required: true, authenticated: false, via: null });
  });

  it('treats servers without the endpoint as needing no sign-in', async () => {
    fetchMock.mockResolvedValue(new Response('Not found', { status: 404 }));
    const { getSessionStatus } = await import('./session-api');
    expect((await getSessionStatus()).auth_required).toBe(false);
  });

  it('posts the passcode and stores nothing client-side', async () => {
    fetchMock.mockResolvedValue(json({ auth_required: true, authenticated: true }));
    const { signIn } = await import('./session-api');
    await signIn('open sesame');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/v1/auth/session');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ passcode: 'open sesame' });
    expect(localStorage.getItem('openjarvis-settings')).toBeNull();
  });

  it('reports a wrong passcode', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Wrong passcode' }, 401));
    const { signIn } = await import('./session-api');
    await expect(signIn('nope')).rejects.toThrow('Wrong passcode');
  });

  it('passes the lockout time through on 429', async () => {
    fetchMock.mockResolvedValue(json({ detail: 'Too many attempts. Try again in 10 min.' }, 429, { 'Retry-After': '540' }));
    const { signIn, SignInError } = await import('./session-api');
    const err = await signIn('x').catch((e) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect(err.retryAfterSeconds).toBe(540);
  });

  it('signs out with DELETE', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { signOut } = await import('./session-api');
    await signOut();
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });
});

describe('apiFetch 401 signal', () => {
  it('announces 401s so the app can show sign-in', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const { apiFetch } = await import('./api');
    const { UNAUTHORIZED_EVENT } = await import('./session-api');
    await apiFetch('/v1/personal/tasks');
    expect(events).toEqual([UNAUTHORIZED_EVENT]);
  });

  it('stays quiet otherwise', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const { apiFetch } = await import('./api');
    await apiFetch('/v1/personal/tasks');
    expect(events).toEqual([]);
  });
});

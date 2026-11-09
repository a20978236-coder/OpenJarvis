import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { COOKIE_NAME, issueToken, MAX_FAILURES, memoryLimiter, verifyToken } from '../src/session';

const SECRET = 'x'.repeat(40);
const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response('<html>app</html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
  HELL_PASSCODE: 'blue falcon 42',
  SESSION_SECRET: SECRET,
  ...over,
});
const req = (path: string, init: RequestInit & { cookie?: string; origin?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.origin !== null) headers.set('Origin', init.origin ?? 'https://hell.example.workers.dev');
  headers.set('CF-Connecting-IP', '203.0.113.7');
  return new Request(`https://hell.example.workers.dev${path}`, { ...init, headers });
};
const login = (passcode: string, origin?: string | null) =>
  req('/v1/auth/session', { method: 'POST', body: JSON.stringify({ passcode }), headers: { 'Content-Type': 'application/json' }, origin });

describe('HELL Worker', () => {
  it('serves health without sign-in and the app for other paths', async () => {
    const lim = memoryLimiter();
    expect(await (await handle(req('/health'), env(), lim)).json()).toEqual({ status: 'ok', hell: 'cloud' });
    expect(await (await handle(req('/m'), env(), lim)).text()).toContain('app');
  });

  it('signs in with the right passcode and sets a secure cookie', async () => {
    const r = await handle(login('blue falcon 42'), env(), memoryLimiter());
    expect(r.status).toBe(200);
    const cookie = r.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=v1\\.`));
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(flag);
    expect(cookie).not.toContain('blue falcon');
    const token = cookie.split(';')[0].split('=').slice(1).join('=');
    const status = await (await handle(req('/v1/auth/session', { cookie: `${COOKIE_NAME}=${token}` }), env(), memoryLimiter())).json();
    expect(status).toEqual({ auth_required: true, authenticated: true, via: 'cookie' });
  });

  it('refuses a wrong passcode, then throttles', async () => {
    const lim = memoryLimiter();
    for (let i = 0; i < MAX_FAILURES; i++) expect((await handle(login('nope nope'), env(), lim)).status).toBe(401);
    const blocked = await handle(login('blue falcon 42'), env(), lim);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('refuses cross-site sign-in', async () => {
    expect((await handle(login('blue falcon 42', 'https://evil.example'), env(), memoryLimiter())).status).toBe(403);
    expect((await handle(login('blue falcon 42', 'null'), env(), memoryLimiter())).status).toBe(403);
  });

  it('is never open: without a passcode/secret configured, sign-in is refused', async () => {
    for (const e of [env({ HELL_PASSCODE: undefined }), env({ HELL_PASSCODE: 'short' }), env({ SESSION_SECRET: 'too-short' })]) {
      const r = await handle(login('anything long enough'), e, memoryLimiter());
      expect(r.status).toBe(503);
      expect((await handle(req('/v1/anything'), e, memoryLimiter())).status).toBe(401);
    }
  });

  it('every other /v1 route needs a valid session', async () => {
    expect((await handle(req('/v1/models'), env(), memoryLimiter())).status).toBe(401);
    const forged = `v1.${Math.floor(Date.now() / 1000) + 999}.abc.notasignature`;
    expect((await handle(req('/v1/models', { cookie: `${COOKIE_NAME}=${forged}` }), env(), memoryLimiter())).status).toBe(401);
    const good = await issueToken(SECRET);
    expect((await handle(req('/v1/models', { cookie: `${COOKIE_NAME}=${good}` }), env(), memoryLimiter())).status).toBe(404);
  });

  it('tokens expire, and rotating the secret signs everyone out', async () => {
    const t = await issueToken(SECRET, Date.now() - 31 * 24 * 3600 * 1000);
    expect(await verifyToken(SECRET, t)).toBe(false);
    const fresh = await issueToken(SECRET);
    expect(await verifyToken(SECRET, fresh)).toBe(true);
    expect(await verifyToken('y'.repeat(40), fresh)).toBe(false);
  });

  it('reports cloud diagnostics to signed-in users only', async () => {
    expect((await handle(req('/v1/hell/diagnostics'), env(), memoryLimiter())).status).toBe(401);
    const good = await issueToken(SECRET);
    const r = await handle(req('/v1/hell/diagnostics', { cookie: `${COOKIE_NAME}=${good}` }), env(), memoryLimiter());
    expect(r.status).toBe(200);
    const body = (await r.json()) as { hell: string; ai: { configured: boolean; healthy: boolean }; voice: unknown; internet: unknown };
    expect(body.hell).toBe('cloud');
    expect(body.ai).toMatchObject({ engine: 'cloud', configured: false, healthy: false });
    expect(body.voice).toEqual({ stt: '', tts: null });
    expect(body.internet).toBeTypeOf('object');
  });

  it('sign-out clears the cookie', async () => {
    const r = await handle(req('/v1/auth/session', { method: 'DELETE' }), env(), memoryLimiter());
    expect(r.status).toBe(204);
    expect(r.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});

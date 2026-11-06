/**
 * Passcode sign-in for HELL in the cloud, matching the contract of the
 * OpenJarvis server's /v1/auth/session so the iPhone app works unchanged.
 *
 *  - The passcode lives only in the Worker's secrets (HELL_PASSCODE).
 *  - A correct passcode earns an HttpOnly, Secure, SameSite=Strict cookie
 *    holding a signed, expiring token — never the passcode or any key.
 *  - Unlike a home server, this is on the public internet: without a
 *    passcode configured, sign-in is refused (never "open").
 *  - Rotating SESSION_SECRET signs every device out.
 */

export const COOKIE_NAME = 'hell_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;
export const MIN_PASSCODE_LENGTH = 8;
const TOKEN_VERSION = 'v1';

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Constant-time comparison of two strings (via their SHA-256 digests). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function configured(env: { HELL_PASSCODE?: string; SESSION_SECRET?: string }): boolean {
  return (env.HELL_PASSCODE ?? '').length >= MIN_PASSCODE_LENGTH && (env.SESSION_SECRET ?? '').length >= 32;
}

export async function issueToken(secret: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const body = `${TOKEN_VERSION}.${exp}.${nonce}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken(secret: string, token: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return false;
  const expected = await hmac(secret, parts.slice(0, 3).join('.'));
  return safeEqual(expected, parts[3]);
}

export function readCookie(request: Request, name = COOKIE_NAME): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

/** A sign-in POST must come from HELL's own pages (blocks cross-site login). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  const host = new URL(request.url).host.toLowerCase();
  if (!origin) {
    // Some browsers omit Origin on same-origin POSTs; Fetch Metadata fills in.
    const site = request.headers.get('Sec-Fetch-Site');
    return site === null || site === 'same-origin' || site === 'none';
  }
  if (origin === 'null') return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// ---- Throttling failed sign-ins ---------------------------------------------

export interface Limiter {
  /** Seconds to wait before another attempt, or 0. */
  retryAfter(who: string): Promise<number>;
  recordFailure(who: string): Promise<void>;
  reset(who: string): Promise<void>;
}

export const MAX_FAILURES = 5;
export const WINDOW_SECONDS = 600;

/**
 * Failure counter kept in Cloudflare's cache (per data centre; free, and no
 * database to set up). Combined with a long passcode this makes guessing
 * impractical. 5 wrong tries → 10 minutes' wait.
 */
export function cacheLimiter(cache: Cache, origin: string): Limiter {
  const key = (who: string) => new Request(`${origin}/__hell_limiter/${encodeURIComponent(who)}`);
  const read = async (who: string) => {
    const r = await cache.match(key(who));
    if (!r) return { n: 0, since: 0 };
    try {
      return (await r.json()) as { n: number; since: number };
    } catch {
      return { n: 0, since: 0 };
    }
  };
  return {
    async retryAfter(who) {
      const s = await read(who);
      if (s.n < MAX_FAILURES) return 0;
      const left = Math.ceil(s.since / 1000 + WINDOW_SECONDS - Date.now() / 1000);
      return left > 0 ? left : 0;
    },
    async recordFailure(who) {
      const s = await read(who);
      const fresh = !s.since || Date.now() - s.since > WINDOW_SECONDS * 1000;
      const next = fresh ? { n: 1, since: Date.now() } : { n: s.n + 1, since: s.since };
      await cache.put(key(who), new Response(JSON.stringify(next), { headers: { 'Cache-Control': `max-age=${WINDOW_SECONDS}` } }));
    },
    async reset(who) {
      await cache.delete(key(who));
    },
  };
}

/** In-memory limiter for tests. */
export function memoryLimiter(): Limiter {
  const m = new Map<string, { n: number; since: number }>();
  return {
    async retryAfter(who) {
      const s = m.get(who);
      if (!s || s.n < MAX_FAILURES) return 0;
      return Math.max(0, Math.ceil(s.since / 1000 + WINDOW_SECONDS - Date.now() / 1000));
    },
    async recordFailure(who) {
      const s = m.get(who);
      m.set(who, s ? { n: s.n + 1, since: s.since } : { n: 1, since: Date.now() });
    },
    async reset(who) {
      m.delete(who);
    },
  };
}

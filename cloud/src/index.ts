/**
 * HELL's Cloudflare Worker.
 *
 * Serves the iPhone app (static files, via the ASSETS binding) and a small
 * API at the same paths the OpenJarvis server uses, so the app needs no
 * changes to its screens:
 *   GET  /health               — liveness (no sign-in needed)
 *   /v1/auth/session           — passcode sign-in (see session.ts)
 *   /v1/*                      — everything else requires a session; routes
 *                                arrive in later phases (cloud AI, weather…)
 *
 * Secrets (set in the Cloudflare dashboard, never in code):
 *   HELL_PASSCODE   — the passcode you type on the iPhone (8+ characters)
 *   SESSION_SECRET  — 32+ random characters that sign session cookies
 */
import {
  cacheLimiter,
  clearCookie,
  configured,
  issueToken,
  readCookie,
  safeEqual,
  sameOrigin,
  sessionCookie,
  verifyToken,
  type Limiter,
} from './session';

export interface Env {
  ASSETS: Fetcher;
  HELL_PASSCODE?: string;
  SESSION_SECRET?: string;
}

const SESSION_PATH = '/v1/auth/session';

/** Headers on every Worker (API) response; static files get cloud/_headers. */
const API_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...API_HEADERS, ...headers },
  });

async function authenticated(request: Request, env: Env): Promise<boolean> {
  return configured(env) && verifyToken(env.SESSION_SECRET!, readCookie(request));
}

async function session(request: Request, env: Env, limiter: Limiter): Promise<Response> {
  if (request.method === 'GET') {
    const ok = await authenticated(request, env);
    return json({ auth_required: true, authenticated: ok, via: ok ? 'cookie' : null });
  }
  if (request.method === 'DELETE') {
    return new Response(null, { status: 204, headers: { ...API_HEADERS, 'Set-Cookie': clearCookie() } });
  }
  if (request.method !== 'POST') return json({ detail: 'Method not allowed' }, 405, { Allow: 'GET, POST, DELETE' });

  if (!configured(env)) {
    return json({ detail: 'HELL is not set up yet: add HELL_PASSCODE (8+ characters) and SESSION_SECRET (32+ characters) in Cloudflare.' }, 503);
  }
  if (!sameOrigin(request)) return json({ detail: 'Cross-site sign-in refused' }, 403);

  const who = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const wait = await limiter.retryAfter(who);
  if (wait) {
    return json({ detail: `Too many attempts. Try again in ${Math.floor(wait / 60) + 1} min.` }, 429, { 'Retry-After': String(wait) });
  }
  let passcode = '';
  try {
    const body = (await request.json()) as { passcode?: unknown };
    passcode = typeof body?.passcode === 'string' ? body.passcode.slice(0, 1024) : '';
  } catch {
    return json({ detail: 'Expected JSON: {"passcode": "..."}' }, 400);
  }
  if (!passcode || !(await safeEqual(passcode, env.HELL_PASSCODE!))) {
    await limiter.recordFailure(who);
    return json({ detail: 'Wrong passcode' }, 401);
  }
  await limiter.reset(who);
  const token = await issueToken(env.SESSION_SECRET!);
  return json({ auth_required: true, authenticated: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}

/**
 * What the cloud side can see, in the same shape as the home server's
 * /v1/hell/diagnostics. Cloud AI (Claude) arrives in phase 4, so it is
 * reported as "not set up" rather than broken; memory now lives on the
 * phone, so the section is left out.
 */
async function diagnostics(probe: () => Promise<Response> = () => fetch('https://cloudflare.com/cdn-cgi/trace')) {
  const t0 = Date.now();
  let internet: { ok: boolean; latency_ms?: number; error?: string };
  try {
    const r = await probe();
    internet = { ok: r.ok, latency_ms: Date.now() - t0 };
  } catch (e) {
    internet = { ok: false, error: e instanceof Error ? e.name : 'Error' };
  }
  return {
    hell: 'cloud',
    ai: { engine: 'cloud', model: '', healthy: false, models: 0, latency_ms: null, configured: false },
    internet,
    voice: { stt: '', tts: null },
  };
}

export async function handle(request: Request, env: Env, limiter: Limiter): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/health') return json({ status: 'ok', hell: 'cloud' });
  if (url.pathname === SESSION_PATH) return session(request, env, limiter);
  if (url.pathname.startsWith('/v1/')) {
    if (!(await authenticated(request, env))) return json({ detail: 'Sign in to HELL first' }, 401);
    if (url.pathname === '/v1/hell/diagnostics' && request.method === 'GET') return json(await diagnostics());
    // Routes for later phases (cloud AI, weather, vision, reminders) go here.
    return json({ detail: 'Not available in HELL cloud yet' }, 404);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = new URL(request.url).origin;
    return handle(request, env, cacheLimiter(caches.default, origin));
  },
} satisfies ExportedHandler<Env>;

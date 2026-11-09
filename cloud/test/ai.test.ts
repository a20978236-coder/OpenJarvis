import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';
import { costUsd, translate } from '../src/ai';
import { COOKIE_NAME, issueToken, memoryLimiter } from '../src/session';

const SECRET = 'x'.repeat(40);
const KEY = 'sk-ant-test-' + 'k'.repeat(30);

function memoryKV() {
  const m = new Map<string, string>();
  return { m, kv: { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace };
}

type Call = { url: string; body: Record<string, unknown> | null; headers: Headers };
function fakeClaude(opts: { text?: string; stopReason?: string; status?: number; model?: string } = {}) {
  const calls: Call[] = [];
  const model = opts.model ?? 'claude-opus-5-5';
  const usage = { input_tokens: 1000, output_tokens: 500 };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const raw = init?.body ?? (input instanceof Request ? await input.text() : null);
    const body = raw ? JSON.parse(String(raw)) : null;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
    calls.push({ url, body, headers });
    if (opts.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }), { status: opts.status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/v1/models/')) return Response.json({ id: model, type: 'model', display_name: 'Claude', created_at: '2026-01-01T00:00:00Z' });
    const text = opts.text ?? 'Hello from Claude';
    const stop = opts.stopReason ?? 'end_turn';
    if (!body?.stream) {
      return Response.json({ id: 'msg_1', type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: stop, stop_sequence: null, usage });
    }
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const parts = [
      ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } }),
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      ...text.split(' ').map((w, i) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: (i ? ' ' : '') + w } })),
      ev('content_block_stop', { index: 0 }),
      ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 500 } }),
      ev('message_stop', {}),
    ];
    return new Response(parts.join(''), { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

async function signedIn(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cookie', `${COOKIE_NAME}=${await issueToken(SECRET)}`);
  return new Request(`https://hell.example.workers.dev${path}`, { ...init, headers });
}
const env = (over: Partial<Env> = {}): Env => ({
  ASSETS: { fetch: async () => new Response('app') } as unknown as Fetcher,
  HELL_PASSCODE: 'blue falcon 42',
  SESSION_SECRET: SECRET,
  ANTHROPIC_API_KEY: KEY,
  ...over,
});
const chat = (body: object) => signedIn('/v1/chat/completions', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const pending: Promise<unknown>[] = [];
const deps = (fetchFn: typeof fetch) => ({ fetch: fetchFn, waitUntil: (p: Promise<unknown>) => void pending.push(p) });

describe('HELL cloud AI', () => {
  it('needs sign-in, and says plainly when no key is set', async () => {
    const r = await handle(new Request('https://hell.example.workers.dev/v1/chat/completions', { method: 'POST' }), env(), memoryLimiter());
    expect(r.status).toBe(401);
    const noKey = await handle(await chat({ messages: [{ role: 'user', content: 'hi' }] }), env({ ANTHROPIC_API_KEY: undefined }), memoryLimiter());
    expect(noKey.status).toBe(503);
    expect(((await noKey.json()) as { detail: string }).detail).toMatch(/ANTHROPIC_API_KEY/);
    const models = await handle(await signedIn('/v1/models'), env({ ANTHROPIC_API_KEY: undefined }), memoryLimiter());
    expect(((await models.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it('lists Claude and reports server info once the key is set', async () => {
    const models = (await (await handle(await signedIn('/v1/models'), env(), memoryLimiter())).json()) as { data: { id: string }[] };
    expect(models.data.map((m) => m.id)).toEqual(['claude-opus-5-5']);
    expect(await (await handle(await signedIn('/v1/info'), env(), memoryLimiter())).json()).toEqual({ engine: 'cloud', model: 'claude-opus-5-5', agent: null });
  });

  it('streams Claude’s reply as OpenAI-style chunks and records the cost', async () => {
    const { calls, fetchFn } = fakeClaude({ text: 'Hello there friend' });
    const { m, kv } = memoryKV();
    const r = await handle(await chat({ model: 'claude-opus-5-5', stream: true, temperature: 0.7, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'hi' }] }), env({ USAGE: kv }), memoryLimiter(), deps(fetchFn));
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toMatch(/event-stream/);
    const text = await r.text();
    await Promise.all(pending);
    const deltas = text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0].delta.content ?? '').join('');
    expect(deltas).toBe('Hello there friend');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
    // Request sent to Anthropic: right model, system prompt, no temperature, key only server-side.
    const sent = calls[0];
    expect(sent.url).toMatch(/api\.anthropic\.com\/v1\/messages/);
    expect(sent.body).toMatchObject({ model: 'claude-opus-5-5', system: 'Be brief.', fallbacks: 'default', output_config: { effort: 'low' } });
    expect(sent.body).not.toHaveProperty('temperature');
    expect(sent.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(sent.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    // 1000 in × $4/M + 500 out × $20/M = $0.014
    expect(Number([...m.values()][0])).toBeCloseTo(0.014, 6);
  });

  it('answers non-streamed requests (hologram builder) and passes photos (vision)', async () => {
    const { calls, fetchFn } = fakeClaude({ text: '{"ops":[]}' });
    const r = await handle(
      await chat({ stream: false, messages: [{ role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }] }] }),
      env(),
      memoryLimiter(),
      deps(fetchFn),
    );
    const body = (await r.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0].message.content).toBe('{"ops":[]}');
    const content = (calls[0].body!.messages as { content: { type: string }[] }[])[0].content;
    expect(content.map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('turns a safety decline into a plain sentence', async () => {
    const { fetchFn } = fakeClaude({ text: '', stopReason: 'refusal' });
    const r = await handle(await chat({ stream: false, messages: [{ role: 'user', content: 'x' }] }), env(), memoryLimiter(), deps(fetchFn));
    expect(((await r.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content).toMatch(/can’t help/);
  });

  it('stops at the daily budget', async () => {
    const { calls, fetchFn } = fakeClaude();
    const { m, kv } = memoryKV();
    m.set(`spend:${new Date().toISOString().slice(0, 10)}`, '1.5');
    const r = await handle(await chat({ messages: [{ role: 'user', content: 'hi' }] }), env({ USAGE: kv, DAILY_LIMIT_USD: '1.5' }), memoryLimiter(), deps(fetchFn));
    expect(r.status).toBe(429);
    expect(((await r.json()) as { detail: string }).detail).toMatch(/\$1\.50/);
    expect(calls).toHaveLength(0);
  });

  it('explains a rejected key instead of leaking details', async () => {
    const { fetchFn } = fakeClaude({ status: 401 });
    const r = await handle(await chat({ stream: true, messages: [{ role: 'user', content: 'hi' }] }), env(), memoryLimiter(), deps(fetchFn));
    expect(r.status).toBe(502);
    expect(((await r.json()) as { detail: string }).detail).toMatch(/ANTHROPIC_API_KEY/);
    const diag = (await (await handle(await signedIn('/v1/hell/diagnostics'), env(), memoryLimiter(), deps(fetchFn))).json()) as { ai: { healthy: boolean; configured: boolean } };
    expect(diag.ai).toMatchObject({ configured: true, healthy: false });
  });

  it('validates the conversation and prices conservatively', () => {
    expect(() => translate({ messages: [] })).toThrow();
    expect(() => translate({ messages: [{ role: 'assistant', content: 'hi' }] })).toThrow();
    expect(() => translate({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] }] })).toThrow(/Photos/);
    expect(translate({ messages: [{ role: 'user', content: 'hi' }] }).system).toMatch(/HELL/);
    expect(costUsd('some-future-model', { input_tokens: 1e6, output_tokens: 0 })).toBe(10);
  });
});

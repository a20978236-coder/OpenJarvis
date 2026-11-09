/**
 * HELL's cloud AI: Claude, reached only from this Worker.
 *
 * The iPhone app speaks the OpenAI-style /v1/chat/completions protocol the
 * OpenJarvis server uses (streamed or not, with optional photos). This file
 * translates that to Anthropic's Messages API, so the app's screens need no
 * changes. The Anthropic key lives in the Worker's secrets (ANTHROPIC_API_KEY)
 * and never reaches the phone.
 *
 * Spending is capped per day (DAILY_LIMIT_USD, default $1): the cost of each
 * reply is added to a counter in Workers KV, and once the day's total reaches
 * the cap HELL politely refuses until midnight UTC.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export const CLOUD_MODEL = 'claude-opus-5-5';
/** Fallback on a safety decline: Anthropic picks the model by category. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_OUTPUT_TOKENS = 8192;
const MAX_MESSAGES = 60;
const DEFAULT_DAILY_LIMIT_USD = 1;

const DEFAULT_SYSTEM =
  'You are HELL, a personal assistant that the user talks to on their iPhone. ' +
  'Answer helpfully and concisely; replies are often read aloud, so prefer short paragraphs over long lists unless asked. ' +
  'If you are unsure, say so.';

export interface AiEnv {
  ANTHROPIC_API_KEY?: string;
  DAILY_LIMIT_USD?: string;
  USAGE?: KVNamespace;
}

export interface AiDeps {
  /** Lets tests replace the network. */
  fetch?: typeof fetch;
  now?: () => Date;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const aiConfigured = (env: AiEnv) => (env.ANTHROPIC_API_KEY ?? '').length > 20;

const client = (env: AiEnv, deps: AiDeps) =>
  new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries: 1, ...(deps.fetch ? { fetch: deps.fetch } : {}) });

// ---- Spending cap --------------------------------------------------------------

/** USD per million tokens [input, output], by the model that actually answered. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5-5': [2, 10],
};
const PRICE_UNKNOWN: [number, number] = [10, 50]; // most expensive tier: never under-count

export function costUsd(model: string, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }): number {
  const [pin, pout] = PRICES[model] ?? PRICE_UNKNOWN;
  const input = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * pin + (usage.output_tokens ?? 0) * pout) / 1e6;
}

const dayKey = (d: Date) => `spend:${d.toISOString().slice(0, 10)}`;
const limitUsd = (env: AiEnv) => {
  const n = Number(env.DAILY_LIMIT_USD);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT_USD;
};

export async function spentToday(env: AiEnv, now: Date): Promise<number> {
  if (!env.USAGE) return 0;
  return Number((await env.USAGE.get(dayKey(now))) ?? 0) || 0;
}

async function addSpend(env: AiEnv, now: Date, usd: number): Promise<void> {
  if (!env.USAGE || !(usd > 0)) return;
  const total = (await spentToday(env, now)) + usd;
  await env.USAGE.put(dayKey(now), total.toFixed(6), { expirationTtl: 3 * 24 * 3600 });
}

// ---- Request translation -------------------------------------------------------

type OpenAiPart = { type?: string; text?: unknown; image_url?: { url?: unknown } | string };
type OpenAiMessage = { role?: unknown; content?: unknown };
export interface ChatBody {
  messages?: unknown;
  stream?: unknown;
  max_tokens?: unknown;
}

export class BadRequest extends Error {}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function toBlocks(content: unknown): BetaContentBlockParam[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: BetaContentBlockParam[] = [];
  for (const raw of content as OpenAiPart[]) {
    if (raw?.type === 'text' && typeof raw.text === 'string' && raw.text.trim()) {
      out.push({ type: 'text', text: raw.text });
    } else if (raw?.type === 'image_url') {
      const url = typeof raw.image_url === 'string' ? raw.image_url : raw.image_url?.url;
      const m = typeof url === 'string' ? /^data:([\w/+.-]+);base64,(.+)$/s.exec(url) : null;
      if (!m || !IMAGE_TYPES.has(m[1])) throw new BadRequest('Photos must be sent as JPEG, PNG, GIF or WebP data.');
      // Photos first, then the question: Claude reads images best that way.
      out.unshift({ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg', data: m[2] } });
    }
  }
  return out;
}

export function translate(body: ChatBody): { system: string; messages: BetaMessageParam[] } {
  if (!Array.isArray(body.messages) || body.messages.length === 0) throw new BadRequest('Expected "messages": [...]');
  const system: string[] = [];
  const messages: BetaMessageParam[] = [];
  for (const m of (body.messages as OpenAiMessage[]).slice(-MAX_MESSAGES)) {
    if (m?.role === 'system') {
      if (typeof m.content === 'string' && m.content.trim()) system.push(m.content);
      continue;
    }
    if (m?.role !== 'user' && m?.role !== 'assistant') continue;
    const blocks = toBlocks(m.content);
    if (!blocks.length) continue;
    if (m.role === 'assistant' && messages.length === 0) continue; // must start with the user
    messages.push({ role: m.role, content: blocks });
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new BadRequest('The last message must be from the user.');
  return { system: system.join('\n\n') || DEFAULT_SYSTEM, messages };
}

// ---- Responses -----------------------------------------------------------------

const API_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...API_HEADERS } });

const REFUSAL_TEXT = 'Sorry — I can’t help with that request.';

function describeApiError(e: unknown): { status: number; detail: string } {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, detail: 'Claude refused HELL’s API key. Check ANTHROPIC_API_KEY in Cloudflare.' };
  }
  if (e instanceof Anthropic.RateLimitError) return { status: 429, detail: 'Claude is busy or your Anthropic limit was reached. Try again shortly.' };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, detail: `Claude couldn’t take that request: ${e.message}` };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, detail: 'HELL cloud couldn’t reach Claude. Try again.' };
  if (e instanceof Anthropic.APIError) return { status: 502, detail: `Claude had a problem (${e.status ?? 'error'}). Try again.` };
  return { status: 500, detail: 'HELL cloud AI failed unexpectedly.' };
}

const chunk = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

export async function chatCompletions(request: Request, env: AiEnv, deps: AiDeps = {}): Promise<Response> {
  if (!aiConfigured(env)) {
    return json({ detail: 'Cloud AI is not set up yet: add ANTHROPIC_API_KEY in Cloudflare (see cloud/README.md).' }, 503);
  }
  const now = (deps.now ?? (() => new Date()))();
  const limit = limitUsd(env);
  if ((await spentToday(env, now)) >= limit) {
    return json({ detail: `HELL’s daily cloud AI budget ($${limit.toFixed(2)}) is used up. It resets at midnight UTC.` }, 429);
  }
  let body: ChatBody;
  let req: { system: string; messages: BetaMessageParam[] };
  try {
    body = (await request.json()) as ChatBody;
    req = translate(body);
  } catch (e) {
    return json({ detail: e instanceof BadRequest ? e.message : 'Expected a JSON chat request.' }, 400);
  }

  const params = {
    model: CLOUD_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: req.system,
    messages: req.messages,
    // Chat-style work: low effort keeps replies quick and cheap.
    output_config: { effort: 'low' as const },
    betas: [FALLBACK_BETA],
    fallbacks: 'default' as const,
  };
  const api = client(env, deps);
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(now.getTime() / 1000);

  if (body.stream !== true) {
    try {
      const msg = await api.beta.messages.create({ ...params, stream: false });
      await addSpend(env, now, costUsd(msg.model, msg.usage));
      const text =
        msg.stop_reason === 'refusal' ? REFUSAL_TEXT : msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return json({
        id,
        object: 'chat.completion',
        created,
        model: msg.model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: msg.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
        usage: { prompt_tokens: msg.usage.input_tokens, completion_tokens: msg.usage.output_tokens },
      });
    } catch (e) {
      const { status, detail } = describeApiError(e);
      return json({ detail }, status);
    }
  }

  // Streaming: open Claude's stream first so setup errors still get a real
  // HTTP status, then relay text as OpenAI-style chunks.
  const stream = api.beta.messages.stream(params);
  const reader = stream[Symbol.asyncIterator]();
  let first: IteratorResult<unknown>;
  try {
    first = await reader.next();
  } catch (e) {
    const { status, detail } = describeApiError(e);
    return json({ detail }, status);
  }
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const out = writable.getWriter();
  const send = (s: string) => out.write(enc.encode(s));
  const pump = (async () => {
    let model: string = CLOUD_MODEL;
    try {
      await send(chunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' } }] }));
      for (let r = first; !r.done; r = await reader.next()) {
        const ev = r.value as { type: string; delta?: { type: string; text?: string } };
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          await send(chunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: ev.delta.text } }] }));
        }
      }
      const msg = await stream.finalMessage();
      model = msg.model;
      await addSpend(env, now, costUsd(msg.model, msg.usage));
      if (msg.stop_reason === 'refusal') {
        await send(chunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: `\n\n${REFUSAL_TEXT}` } }] }));
      }
      await send(
        chunk({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: msg.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
          usage: { prompt_tokens: msg.usage.input_tokens, completion_tokens: msg.usage.output_tokens },
        }),
      );
    } catch (e) {
      // Bill whatever was produced before the failure, if Claude reported it.
      const partial = stream.currentMessage;
      if (partial) await addSpend(env, now, costUsd(partial.model, partial.usage)).catch(() => undefined);
      const { detail } = describeApiError(e);
      await send(chunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: `\n\n(${detail})` } }] })).catch(() => undefined);
    } finally {
      await send('data: [DONE]\n\n').catch(() => undefined);
      await out.close().catch(() => undefined);
    }
  })();
  deps.waitUntil?.(pump);
  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', ...API_HEADERS },
  });
}

/** Model list in the OpenAI shape the app expects (empty until a key is set). */
export function modelList(env: AiEnv) {
  return {
    object: 'list',
    data: aiConfigured(env) ? [{ id: CLOUD_MODEL, object: 'model', created: 0, owned_by: 'anthropic' }] : [],
  };
}

/** Cheap key check for Diagnostics: looks the model up, generates nothing. */
export async function aiStatus(env: AiEnv, deps: AiDeps = {}) {
  const base = { engine: 'cloud', model: aiConfigured(env) ? CLOUD_MODEL : '', models: aiConfigured(env) ? 1 : 0, configured: aiConfigured(env) };
  const now = (deps.now ?? (() => new Date()))();
  const budget = { limit_usd: limitUsd(env), spent_today_usd: Math.round((await spentToday(env, now).catch(() => 0)) * 100) / 100 };
  if (!aiConfigured(env)) return { ...base, healthy: false, latency_ms: null, budget };
  const t0 = Date.now();
  try {
    await client(env, deps).models.retrieve(CLOUD_MODEL);
    return { ...base, healthy: true, latency_ms: Date.now() - t0, budget };
  } catch (e) {
    return { ...base, healthy: false, latency_ms: Date.now() - t0, error: describeApiError(e).detail, budget };
  }
}

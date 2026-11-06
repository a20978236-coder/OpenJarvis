/**
 * On-phone AI (Phase 3b feasibility test).
 *
 * Runs a small open model (GGUF, via llama.cpp compiled to WebAssembly —
 * the MIT-licensed `wllama`) entirely inside Safari: no server, no
 * internet after the first download. The model file is downloaded once from
 * Hugging Face straight to the phone and kept in the browser's storage.
 *
 * This module is loaded only when the test is opened, so it adds nothing to
 * the dashboard's start-up.
 */
import type { Wllama } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';

export interface LocalModelPreset {
  id: string;
  name: string;
  /** Approximate download size in MB. */
  sizeMb: number;
  note: string;
  url: string;
}

const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

/** Small instruction-tuned models with open licences, smallest first. */
export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    id: 'smollm2-360m',
    name: 'SmolLM2 360M (Q4_K_M)',
    sizeMb: 271,
    note: 'Smallest and fastest. Simple answers only. Apache-2.0.',
    url: hf('bartowski/SmolLM2-360M-Instruct-GGUF', 'SmolLM2-360M-Instruct-Q4_K_M.gguf'),
  },
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B (Q4_K_M)',
    sizeMb: 491,
    note: 'Recommended first try: small, decent quality. Apache-2.0.',
    url: hf('Qwen/Qwen2.5-0.5B-Instruct-GGUF', 'qwen2.5-0.5b-instruct-q4_k_m.gguf'),
  },
  {
    id: 'llama3.2-1b',
    name: 'Llama 3.2 1B (Q4_K_M)',
    sizeMb: 808,
    note: 'Better answers, but may be too big for an iPhone 12 tab. Llama 3.2 licence.',
    url: hf('bartowski/Llama-3.2-1B-Instruct-GGUF', 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'),
  },
];

export type Phase = 'download' | 'load' | 'generate';

export interface BenchResult {
  model: string;
  ok: boolean;
  error?: string;
  downloadSeconds?: number;
  loadSeconds?: number;
  promptTokensPerSecond?: number;
  tokensPerSecond?: number;
  tokens?: number;
  multithread?: boolean;
  threads?: number;
  gpu: 'on' | 'off';
  webgpuInBrowser: boolean;
  crossOriginIsolated: boolean;
  reply?: string;
  device: string;
  at: string;
}

export const TEST_PROMPT = 'In two short sentences, what can a pocket AI assistant do offline?';

/** Remembered while a test runs: if Safari kills the tab, the next visit can say so. */
const RUNNING_KEY = 'hell.localai.running';

export function unfinishedTest(): string | null {
  try {
    return localStorage.getItem(RUNNING_KEY);
  } catch {
    return null;
  }
}

export function clearUnfinishedTest(): void {
  try {
    localStorage.removeItem(RUNNING_KEY);
  } catch {
    /* storage unavailable */
  }
}

const absolute = (u: string) => new URL(u, location.href).href;

async function create(): Promise<Wllama> {
  const { Wllama, LoggerWithoutDebug } = await import('@wllama/wllama');
  // The worker is started from a blob: URL, so the wasm path must be absolute.
  return new Wllama({ default: absolute(wasmUrl) }, { logger: LoggerWithoutDebug, parallelDownloads: 3 });
}

export interface RunOptions {
  useGpu: boolean;
  onPhase: (phase: Phase, progress?: number) => void;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

/** Download (if needed), load and time one reply. Always frees the model afterwards. */
export async function runBenchmark(preset: LocalModelPreset, opts: RunOptions): Promise<BenchResult> {
  const base: BenchResult = {
    model: preset.name,
    ok: false,
    gpu: opts.useGpu ? 'on' : 'off',
    webgpuInBrowser: typeof navigator !== 'undefined' && 'gpu' in navigator,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    device: navigator.userAgent,
    at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(RUNNING_KEY, preset.name);
  } catch {
    /* storage unavailable */
  }
  let wllama: Wllama | null = null;
  try {
    wllama = await create();
    const cached = await isDownloaded(preset);
    opts.onPhase('download', cached ? 1 : 0);
    const t0 = performance.now();
    let tLoad = t0;
    await wllama.loadModelFromUrl(preset.url, {
      n_ctx: 1024,
      n_gpu_layers: opts.useGpu ? undefined : 0,
      progressCallback: ({ loaded, total }) => {
        opts.onPhase('download', total ? loaded / total : 0);
        if (total && loaded >= total) {
          tLoad = performance.now();
          opts.onPhase('load');
        }
      },
    });
    const t1 = performance.now();
    if (opts.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    opts.onPhase('generate');

    let reply = '';
    let timings: { predicted_per_second?: number; prompt_per_second?: number; predicted_n?: number } | undefined;
    const stream = await wllama.createChatCompletion({
      messages: [{ role: 'user', content: TEST_PROMPT }],
      max_tokens: 64,
      temperature: 0.3,
      stream: true,
    });
    const tGen = performance.now();
    let tokens = 0;
    for await (const chunk of stream) {
      const piece = chunk.choices?.[0]?.delta?.content ?? '';
      if (piece) {
        tokens++;
        reply += piece;
        opts.onToken?.(reply);
      }
      if (chunk.timings) timings = chunk.timings;
      if (opts.signal?.aborted) break;
    }
    const genSeconds = (performance.now() - tGen) / 1000;
    return {
      ...base,
      ok: true,
      // Already on the phone: the whole wait was loading.
      downloadSeconds: cached ? 0 : round((tLoad - t0) / 1000),
      loadSeconds: round((t1 - (cached || tLoad === t0 ? t0 : tLoad)) / 1000),
      promptTokensPerSecond: timings?.prompt_per_second ? round(timings.prompt_per_second) : undefined,
      tokensPerSecond: round(timings?.predicted_per_second ?? (genSeconds > 0 ? tokens / genSeconds : 0)),
      tokens: timings?.predicted_n ?? tokens,
      multithread: wllama.isMultithread(),
      threads: wllama.getNumThreads(),
      reply: reply.trim(),
    };
  } catch (e) {
    return { ...base, error: describeError(e) };
  } finally {
    clearUnfinishedTest();
    try {
      await wllama?.exit();
    } catch {
      /* already gone */
    }
  }
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) return 'Stopped.';
  if (/quota|storage|NotAllowedError/i.test(msg)) return `Not enough storage on the phone for this model (${msg}).`;
  if (/fetch|network|Failed to load|404/i.test(msg)) return `Could not download the model — check your connection (${msg}).`;
  if (/memory|alloc|OOM|RangeError/i.test(msg)) return `The phone ran out of memory for this model (${msg}).`;
  return msg;
}

const round = (n: number) => Math.round(n * 10) / 10;

async function cache() {
  const { CacheManager } = await import('@wllama/wllama');
  return new CacheManager();
}

export async function isDownloaded(preset: LocalModelPreset): Promise<boolean> {
  try {
    const c = await cache();
    const name = await c.getNameFromURL(preset.url);
    return (await c.getSize(name)) > 0;
  } catch {
    return false;
  }
}

export async function deleteDownloaded(preset: LocalModelPreset): Promise<void> {
  const c = await cache();
  await c.delete(preset.url);
}

export interface StorageInfo {
  usedMb: number;
  quotaMb: number;
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  return { usedMb: Math.round((e.usage ?? 0) / 1048576), quotaMb: Math.round((e.quota ?? 0) / 1048576), persisted };
}

/** Ask Safari to keep downloaded models (Home Screen apps are usually granted). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}

export function formatResult(r: BenchResult): string {
  const lines = [
    `HELL on-phone AI test — ${r.model}`,
    r.ok ? 'Result: worked' : `Result: failed — ${r.error}`,
  ];
  if (r.ok) {
    lines.push(
      `Download: ${r.downloadSeconds ? `${r.downloadSeconds} s` : 'already on phone'}`,
      `Load: ${r.loadSeconds} s`,
      `Speed: ${r.tokensPerSecond} tokens/s (reading the question: ${r.promptTokensPerSecond ?? '?'} tokens/s)`,
      `Threads: ${r.threads}${r.multithread ? ' (multi-thread)' : ' (single thread)'}`,
    );
  }
  lines.push(
    `GPU requested: ${r.gpu}; WebGPU in this browser: ${r.webgpuInBrowser ? 'yes' : 'no'}; isolated: ${r.crossOriginIsolated ? 'yes' : 'no'}`,
    `Device: ${r.device}`,
    `When: ${r.at}`,
  );
  if (r.reply) lines.push(`Reply: ${r.reply}`);
  return lines.join('\n');
}

import { describe, expect, it } from 'vitest';
import { LOCAL_MODEL_PRESETS, formatResult, type BenchResult } from './local-ai';

describe('on-phone AI test', () => {
  it('offers small GGUF models downloaded straight from Hugging Face over HTTPS', () => {
    expect(LOCAL_MODEL_PRESETS.length).toBeGreaterThan(0);
    for (const p of LOCAL_MODEL_PRESETS) {
      expect(p.url).toMatch(/^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/main\/[\w.-]+\.gguf$/);
      // Under wllama's 2 GB single-file limit, and small enough to try on a 4 GB iPhone.
      expect(p.sizeMb).toBeLessThan(1024);
    }
    const sizes = LOCAL_MODEL_PRESETS.map((p) => p.sizeMb);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  const base: BenchResult = {
    model: 'Tiny', ok: true, gpu: 'off', webgpuInBrowser: false, crossOriginIsolated: true,
    device: 'iPhone', at: '2026-11-06T00:00:00Z',
  };

  it('formats a shareable summary without anything private', () => {
    const text = formatResult({ ...base, downloadSeconds: 0, loadSeconds: 2.5, tokensPerSecond: 12.3, promptTokensPerSecond: 40, threads: 3, multithread: true, reply: 'Hi' });
    expect(text).toContain('Result: worked');
    expect(text).toContain('already on phone');
    expect(text).toContain('12.3 tokens/s');
    expect(text).toContain('3 (multi-thread)');
  });

  it('reports failures plainly', () => {
    expect(formatResult({ ...base, ok: false, error: 'The phone ran out of memory' })).toContain('Result: failed — The phone ran out of memory');
  });
});

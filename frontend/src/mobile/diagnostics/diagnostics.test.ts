import { describe, expect, it, vi } from 'vitest';
import { aiCheck, cameraCheck, errorsCheck, gestureCheck, internetCheck, memoryCheck, micCheck, renderCheck, reportText, voiceCheck } from './checks';

describe('microphone & camera', () => {
  it('insecure page is a problem with the https fix', () => {
    const c = micCheck({ supported: true, secure: false, permission: 'unknown' });
    expect(c.status).toBe('bad');
    expect(c.fixes[0]).toMatch(/https/);
  });
  it('denied permission explains the iPhone setting', () => {
    expect(micCheck({ supported: true, secure: true, permission: 'denied' }).fixes[0]).toMatch(/Settings › Safari › Microphone/);
    expect(cameraCheck({ supported: true, secure: true, permission: 'prompt', test: { error: 'Permission denied' } }).status).toBe('bad');
  });
  it('a silent mic test is a warning, a heard one is OK', () => {
    expect(micCheck({ supported: true, secure: true, permission: 'granted', test: { peak: 0.005 } }).status).toBe('warn');
    expect(micCheck({ supported: true, secure: true, permission: 'granted', test: { peak: 0.3 } }).status).toBe('ok');
    expect(micCheck({ supported: true, secure: true, permission: 'prompt' }).status).toBe('unknown');
  });
  it('camera test reports the resolution', () => {
    expect(cameraCheck({ supported: true, secure: true, permission: 'granted', test: { width: 1280, height: 720 } })).toMatchObject({ status: 'ok', details: ['1280×720'] });
  });
});

describe('connection & AI', () => {
  it('offline phone vs offline server', () => {
    expect(internetCheck({ browserOnline: false, server: null, serverReachable: false }).status).toBe('bad');
    expect(internetCheck({ browserOnline: true, server: { ok: false, error: 'ConnectError' }, serverReachable: true }).summary).toMatch(/server has no internet/);
    expect(internetCheck({ browserOnline: true, server: { ok: true, latency_ms: 80 }, serverReachable: true }).status).toBe('ok');
  });
  it('unreachable server, dead engine, no models', () => {
    expect(aiCheck({ serverReachable: false, latencyMs: null, ai: null }).fixes.join(' ')).toMatch(/jarvis serve/);
    const ai = { engine: 'ollama', model: 'qwen3:8b', healthy: false, models: 0, latency_ms: 5 };
    expect(aiCheck({ serverReachable: true, latencyMs: 40, ai }).fixes[0]).toMatch(/ollama serve/);
    expect(aiCheck({ serverReachable: true, latencyMs: 40, ai: { ...ai, healthy: true } }).fixes[0]).toMatch(/ollama pull/);
    expect(aiCheck({ serverReachable: true, latencyMs: 40, ai: { ...ai, healthy: true, models: 3 } }).status).toBe('ok');
  });
});

describe('voice, memory, gestures, rendering, errors', () => {
  it('voice: device fallbacks are a warning with server install tips', () => {
    const v = voiceCheck({ stt: '', tts: null, ttsServer: false, deviceVoices: true, deviceRec: true, deviceRecAllowed: true });
    expect(v.status).toBe('warn');
    expect(v.fixes.join(' ')).toMatch(/faster-whisper/);
    expect(voiceCheck({ stt: '', tts: null, ttsServer: false, deviceVoices: true, deviceRec: true, deviceRecAllowed: false }).status).toBe('bad');
    expect(voiceCheck({ stt: 'faster_whisper', tts: 'kokoro', ttsServer: true, deviceVoices: false, deviceRec: false, deviceRecAllowed: false }).status).toBe('ok');
  });
  it('memory: off, pending, learner not running', () => {
    const m = { store: 'sqlite', entries: 3, learning: 'off', use_in_replies: false, learner_running: false };
    expect(memoryCheck(m, 0).summary).toBe('Memory is off');
    expect(memoryCheck({ ...m, use_in_replies: true, learning: 'ask', learner_running: true }, 2).fixes[0]).toMatch(/approve/);
    expect(memoryCheck({ ...m, use_in_replies: true, learning: 'ask', learner_running: false }, 0).summary).toMatch(/not running/);
  });
  it('gestures and rendering', () => {
    expect(gestureCheck({ touch: true, wasm: true, handModel: false, cameraOk: true }).fixes[0]).toMatch(/hand model/);
    expect(gestureCheck({ touch: true, wasm: true, handModel: true, cameraOk: true }).status).toBe('ok');
    expect(renderCheck({ webgl2: true, webgl: true, fps: 18, dpr: 3, reducedMotion: false }).status).toBe('bad');
    expect(renderCheck({ webgl2: true, webgl: true, fps: 60, dpr: 3, reducedMotion: false }).status).toBe('ok');
    expect(renderCheck({ webgl2: false, webgl: false, fps: 60, dpr: 2, reducedMotion: false }).status).toBe('warn');
  });
  it('errors and the text report', () => {
    expect(errorsCheck([]).status).toBe('ok');
    const e = errorsCheck([{ t: 0, message: 'boom', source: 'x' }]);
    expect(e.status).toBe('warn');
    const text = reportText([e, renderCheck({ webgl2: true, webgl: true, fps: 60, dpr: 3, reducedMotion: false })], new Date(0));
    expect(text).toContain('[WARN] Application errors: 1 error(s) this session');
    expect(text).toContain('[OK ] Rendering performance: Smooth');
  });
});

describe('error log', () => {
  it('records uncaught errors and rejections, ignores aborts', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const { installErrorLog, useErrorLog } = await import('../../lib/error-log');
    const handlers: Record<string, (e: unknown) => void> = {};
    installErrorLog({ addEventListener: (n: string, h: (e: unknown) => void) => (handlers[n] = h) } as unknown as Window);
    handlers.error({ message: 'TypeError: x is undefined', filename: 'https://h/app.js' });
    handlers.unhandledrejection({ reason: new Error('fetch failed') });
    handlers.unhandledrejection({ reason: { message: 'The user aborted a request (AbortError)' } });
    handlers.error({ message: '' });
    expect(useErrorLog.getState().errors.map((e) => e.message)).toEqual(['TypeError: x is undefined', 'fetch failed']);
    useErrorLog.getState().clear();
    expect(useErrorLog.getState().errors).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('HELL cloud (no home server)', () => {
  it('reports cloud AI as not set up yet, not as a broken server', () => {
    const c = aiCheck({ serverReachable: true, latencyMs: 40, ai: { engine: 'cloud', model: '', healthy: false, models: 0, latency_ms: null, configured: false } });
    expect(c.status).toBe('warn');
    expect(c.summary).toBe('Cloud AI not set up yet');
    expect(c.fixes.join(' ')).not.toMatch(/jarvis serve|ollama/);
    expect(c.fixes.join(' ')).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('reports Claude, its budget, and a rejected key', () => {
    const ai = { engine: 'cloud', model: 'claude-opus-5-5', models: 1, latency_ms: 90, configured: true, budget: { limit_usd: 1, spent_today_usd: 0.12 } };
    const ok = aiCheck({ serverReachable: true, latencyMs: 40, ai: { ...ai, healthy: true } });
    expect(ok.status).toBe('ok');
    expect(ok.details).toContain('Spent today: $0.12 of $1.00');
    const bad = aiCheck({ serverReachable: true, latencyMs: 40, ai: { ...ai, healthy: false, error: 'Claude refused HELL’s API key.' } });
    expect(bad.status).toBe('bad');
    expect(bad.fixes.join(' ')).toMatch(/ANTHROPIC_API_KEY/);
    const spent = aiCheck({ serverReachable: true, latencyMs: 40, ai: { ...ai, healthy: true, budget: { limit_usd: 1, spent_today_usd: 1 } } });
    expect(spent.summary).toMatch(/budget/);
  });

  it('points to the iPhone speech setting, not server installs', () => {
    const off = voiceCheck({ stt: '', tts: null, ttsServer: false, deviceVoices: true, deviceRec: true, deviceRecAllowed: false, cloud: true });
    expect(off.status).toBe('bad');
    expect(off.details).toContain('Listening: iPhone speech recognition is switched off');
    expect(off.fixes.join(' ')).toMatch(/Allow iPhone speech recognition/);
    expect(off.fixes.join(' ')).not.toMatch(/faster-whisper|Kokoro/);
    const on = voiceCheck({ stt: '', tts: null, ttsServer: false, deviceVoices: true, deviceRec: true, deviceRecAllowed: true, cloud: true });
    expect(on.status).toBe('ok');
  });

  it('explains where memory is going', () => {
    expect(memoryCheck(null, 0, true).summary).toMatch(/phone/);
    expect(memoryCheck(null, 0).summary).toBe('Not checked');
  });
});

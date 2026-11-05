import { afterEach, describe, expect, it, vi } from 'vitest';
import { levelAt, wavEnvelope } from './audio-level';
import { matchWakePhrase, recognizeOnce } from './device-speech';
import { createVad, DEFAULT_VAD } from './vad';
import { pickInputEngine, pickOutputEngine, sanitizeVoicePrefs } from './voice-prefs';
import { prettyServerVoice } from '../mobile/voice/voice-names';

function wav16(samples: number[], rate = 1000): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(s * 32767), true));
  return buf;
}

describe('voice prefs', () => {
  it('sanitizes and keeps device recognition opt-in', () => {
    const p = sanitizeVoicePrefs({ output: 'loud', rate: 9, wakePhrase: true, input: 'device' });
    expect(p.output).toBe('auto');
    expect(p.rate).toBe(1.6);
    expect(p.wakePhrase).toBe(false); // needs allowDeviceRecognition
    expect(p.input).toBe('auto');
    expect(sanitizeVoicePrefs({ allowDeviceRecognition: true, wakePhrase: true, input: 'device' })).toMatchObject({ wakePhrase: true, input: 'device' });
    expect(sanitizeVoicePrefs(null)).toMatchObject({ output: 'auto', rate: 1, autoStop: true, continueConversation: true, allowDeviceRecognition: false });
  });

  it('picks the speaking engine', () => {
    expect(pickOutputEngine('auto', true, true)).toBe('server');
    expect(pickOutputEngine('auto', false, true)).toBe('device');
    expect(pickOutputEngine('auto', false, false)).toBeNull();
    expect(pickOutputEngine('server', false, true)).toBeNull();
    expect(pickOutputEngine('device', true, true)).toBe('device');
  });

  it('never uses device recognition unless allowed', () => {
    expect(pickInputEngine('auto', false, true, false)).toBeNull();
    expect(pickInputEngine('auto', false, true, true)).toBe('device');
    expect(pickInputEngine('auto', true, true, true)).toBe('server');
    expect(pickInputEngine('device', true, true, false)).toBeNull();
  });
});

describe('wav envelope (voice-reactive orb)', () => {
  it('follows the loudness of the audio over time', () => {
    // 1000 Hz sample rate, 40 ms frames = 40 samples each: silence, loud, quiet.
    const s = [...Array(40).fill(0), ...Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.25 : -0.25)), ...Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.05 : -0.05))];
    const env = wavEnvelope(wav16(s));
    expect(env).not.toBeNull();
    expect(env!.frames.length).toBe(3);
    expect(levelAt(env, 0.01)).toBe(0);
    expect(levelAt(env, 0.05)!).toBeGreaterThan(0.7);
    expect(levelAt(env, 0.1)!).toBeLessThan(levelAt(env, 0.05)!);
    expect(levelAt(env, 5)).toBe(0); // past the end
  });

  it('rejects things that are not a readable WAV', () => {
    expect(wavEnvelope(new ArrayBuffer(10))).toBeNull();
    expect(wavEnvelope(new TextEncoder().encode('x'.repeat(64)).buffer)).toBeNull();
    expect(levelAt(null, 1)).toBeNull();
  });
});

describe('silence detection', () => {
  const run = (levels: [number, number][]) => {
    const v = createVad(DEFAULT_VAD);
    let st = '';
    for (const [ms, level] of levels) for (let t = 0; t < ms; t += 50) st = v.feed(level, (run as unknown as { t: number }).t = ((run as unknown as { t: number }).t ?? 0) + 50);
    return st;
  };
  it('ends after you speak and then pause', () => {
    (run as unknown as { t: number }).t = 0;
    expect(run([[400, 0.01], [1200, 0.4], [1500, 0.01]])).toBe('done');
  });
  it('keeps listening through short pauses between words', () => {
    (run as unknown as { t: number }).t = 0;
    expect(run([[1000, 0.4], [600, 0.01], [800, 0.4], [400, 0.01]])).toBe('speech');
  });
  it('gives up when nothing is said', () => {
    (run as unknown as { t: number }).t = 0;
    expect(run([[7200, 0.01]])).toBe('no-speech');
  });
  it('a click is not speech', () => {
    (run as unknown as { t: number }).t = 0;
    expect(run([[100, 0.6], [7200, 0.01]])).toBe('no-speech');
  });
  it('talking straight away (during calibration) still works', () => {
    (run as unknown as { t: number }).t = 0;
    expect(run([[1500, 0.45], [1500, 0.01]])).toBe('done');
  });
  it('adapts to a noisy room', () => {
    (run as unknown as { t: number }).t = 0;
    // Steady fan noise at 0.1 (above the base threshold) must not count as talking forever.
    expect(run([[3000, 0.1], [1500, 0.5], [1600, 0.1]])).toBe('done');
  });
});

describe('wake phrase', () => {
  it.each([
    ['hey hell', true, ''],
    ['Hey HELL, what time is it?', true, 'what time is it?'],
    ['ok hell turn on the lights', true, 'turn on the lights'],
    ['hi hal', true, ''],
    ['what the hell', false, ''],
    ['hello there', false, ''],
    ['shell script', false, ''],
  ])('%s', (text, matched, remainder) => {
    expect(matchWakePhrase(text)).toEqual({ matched, remainder });
  });
});

describe('device recognition', () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeRec {
    static last: FakeRec;
    lang = '';
    continuous = true;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() {
      FakeRec.last = this;
    }
    start() {}
    stop() {
      this.onend?.();
    }
    abort() {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    }
    say(text: string, isFinal: boolean) {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
    }
  }

  it('resolves with what was said and streams interim words', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRec);
    const seen: string[] = [];
    const s = recognizeOnce((t) => seen.push(t));
    FakeRec.last.say('what is', false);
    FakeRec.last.say('what is the weather', true);
    FakeRec.last.onend?.();
    await expect(s.result).resolves.toBe('what is the weather');
    expect(seen[0]).toBe('what is');
    expect(FakeRec.last.continuous).toBe(false);
  });

  it('abort discards the words', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRec);
    const s = recognizeOnce();
    FakeRec.last.say('never mind', true);
    s.abort();
    await expect(s.result).resolves.toBe('');
  });

  it('explains a permission error', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRec);
    const s = recognizeOnce();
    FakeRec.last.onerror?.({ error: 'not-allowed' });
    await expect(s.result).rejects.toThrow(/not allowed/);
  });

  it('reports when unsupported', async () => {
    await expect(recognizeOnce().result).rejects.toThrow(/not supported/);
  });
});

describe('server voice names', () => {
  it('reads Kokoro ids', () => {
    expect(prettyServerVoice('bm_george')).toBe('George (British, male)');
    expect(prettyServerVoice('af_heart')).toBe('Heart (American, female)');
    expect(prettyServerVoice('de_DE-thorsten-medium')).toBe('de_DE-thorsten-medium');
  });
});

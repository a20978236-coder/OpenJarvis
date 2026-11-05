import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  synthesizeSpeech: vi.fn(),
  fetchTtsHealth: vi.fn(),
}));

import { synthesizeSpeech, fetchTtsHealth } from './api';
import { __resetTtsForTests, getSpeechLevel, useTtsStore } from './tts';
import { useVoicePrefs } from './voice-prefs';

const synth = vi.mocked(synthesizeSpeech);
const health = vi.mocked(fetchTtsHealth);

class Utterance {
  text: string;
  rate = 1;
  voice: unknown = null;
  lang = '';
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onboundary: (() => void) | null = null;
  constructor(t: string) {
    this.text = t;
  }
}
const spoken: Utterance[] = [];
const speechSynthesisFake = {
  speak: vi.fn((u: Utterance) => spoken.push(u)),
  cancel: vi.fn(),
  getVoices: () => [{ voiceURI: 'com.apple.voice.Daniel', name: 'Daniel', lang: 'en-GB', localService: true }],
};

beforeEach(() => {
  spoken.length = 0;
  vi.stubGlobal('speechSynthesis', speechSynthesisFake);
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  __resetTtsForTests();
  synth.mockReset();
  health.mockReset();
  useVoicePrefs.setState({ output: 'auto', rate: 1, deviceVoice: '', serverVoice: '' });
});
afterEach(() => vi.unstubAllGlobals());

describe('device voice', () => {
  it('speaks with the device when the server has no voice, at the chosen speed and voice', async () => {
    health.mockResolvedValue({ available: false });
    useVoicePrefs.setState({ rate: 1.3, deviceVoice: 'com.apple.voice.Daniel' });
    await useTtsStore.getState().ensureHealth();
    expect(useTtsStore.getState().available).toBe(true); // HELL can still speak
    await useTtsStore.getState().speak('m1', 'Hello there');
    expect(synth).not.toHaveBeenCalled();
    const u = spoken.find((x) => x.text === 'Hello there')!;
    expect(u.rate).toBe(1.3);
    expect(u.lang).toBe('en-GB');
    u.onstart?.();
    expect(useTtsStore.getState()).toMatchObject({ state: 'speaking', engine: 'device', speakingId: 'm1' });
    expect(getSpeechLevel()!).toBeGreaterThan(0.5); // word pulse
    u.onend?.();
    expect(useTtsStore.getState().state).toBe('idle');
    expect(getSpeechLevel()).toBeNull();
  });

  it('falls back to the device voice if the server voice fails (auto)', async () => {
    synth.mockRejectedValue(new Error('No text-to-speech backend available'));
    await useTtsStore.getState().speak('m2', 'Fallback please');
    expect(synth).toHaveBeenCalled();
    expect(spoken.some((x) => x.text === 'Fallback please')).toBe(true);
    expect(useTtsStore.getState().serverAvailable).toBe(false);
  });

  it('server-only mode does not fall back', async () => {
    useVoicePrefs.setState({ output: 'server' });
    synth.mockRejectedValue(new Error('boom'));
    await useTtsStore.getState().speak('m3', 'No fallback');
    expect(spoken.some((x) => x.text === 'No fallback')).toBe(false);
    expect(useTtsStore.getState().error).toBe('boom');
  });

  it('passes the server voice and speed when set', async () => {
    useVoicePrefs.setState({ serverVoice: 'bm_george', rate: 0.8 });
    synth.mockReturnValue(new Promise(() => undefined));
    void useTtsStore.getState().speak('m4', 'Hi');
    await Promise.resolve();
    expect(synth.mock.calls[0][1]).toMatchObject({ voiceId: 'bm_george', speed: 0.8 });
  });

  it('stop() cancels the device voice', async () => {
    useVoicePrefs.setState({ output: 'device' });
    await useTtsStore.getState().speak('m5', 'Long answer');
    spoken.find((x) => x.text === 'Long answer')!.onstart?.();
    useTtsStore.getState().stop();
    expect(speechSynthesisFake.cancel).toHaveBeenCalled();
    expect(useTtsStore.getState().state).toBe('idle');
  });
});

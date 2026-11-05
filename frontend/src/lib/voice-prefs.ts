import { create } from 'zustand';

/**
 * Voice preferences (saved on this device).
 *
 * Output: replies are spoken by the HELL server's voice (e.g. Kokoro, free
 * and local) or by this device's built-in voices (Web Speech; on iPhone the
 * system voices run on the phone). Input: speech is transcribed by the HELL
 * server, or by the device's own recognition (on iPhone this is Apple's
 * speech service, which may process audio on Apple's servers — opt-in).
 */
export type OutputEngine = 'auto' | 'server' | 'device';
export type InputEngine = 'auto' | 'server' | 'device';

export interface VoicePrefs {
  output: OutputEngine;
  /** Server voice id ('' = the server's default). */
  serverVoice: string;
  /** Device voice URI ('' = the system default for the language). */
  deviceVoice: string;
  /** Speaking speed, 1 = normal. */
  rate: number;
  input: InputEngine;
  /** Allow device (Apple/Google) speech recognition. Off until chosen. */
  allowDeviceRecognition: boolean;
  /** Stop listening by itself when you pause. */
  autoStop: boolean;
  /** After answering a spoken question, listen again for a follow-up. */
  continueConversation: boolean;
  /** "Hey HELL" while the app is open (needs device recognition). */
  wakePhrase: boolean;
}

export const RATE_LIMITS: [number, number] = [0.6, 1.6];

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  output: 'auto',
  serverVoice: '',
  deviceVoice: '',
  rate: 1,
  input: 'auto',
  allowDeviceRecognition: false,
  autoStop: true,
  continueConversation: true,
  wakePhrase: false,
};

const KEY = 'hell-voice-v1';

export function sanitizeVoicePrefs(raw: unknown): VoicePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof VoicePrefs, unknown>>;
  const d = DEFAULT_VOICE_PREFS;
  const engine = (v: unknown, fb: OutputEngine) => (v === 'auto' || v === 'server' || v === 'device' ? v : fb);
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '');
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  const rate = typeof r.rate === 'number' && Number.isFinite(r.rate) ? Math.min(RATE_LIMITS[1], Math.max(RATE_LIMITS[0], Math.round(r.rate * 20) / 20)) : d.rate;
  const prefs: VoicePrefs = {
    output: engine(r.output, d.output),
    serverVoice: str(r.serverVoice),
    deviceVoice: str(r.deviceVoice),
    rate,
    input: engine(r.input, d.input),
    allowDeviceRecognition: bool(r.allowDeviceRecognition, d.allowDeviceRecognition),
    autoStop: bool(r.autoStop, d.autoStop),
    continueConversation: bool(r.continueConversation, d.continueConversation),
    wakePhrase: bool(r.wakePhrase, d.wakePhrase),
  };
  // The wake phrase and device input both need device recognition allowed.
  if (!prefs.allowDeviceRecognition) {
    prefs.wakePhrase = false;
    if (prefs.input === 'device') prefs.input = 'auto';
  }
  return prefs;
}

function load(): VoicePrefs {
  try {
    const s = localStorage.getItem(KEY);
    return sanitizeVoicePrefs(s ? JSON.parse(s) : null);
  } catch {
    return sanitizeVoicePrefs(null);
  }
}

interface VoicePrefsStore extends VoicePrefs {
  update: (patch: Partial<VoicePrefs>) => void;
}

export const useVoicePrefs = create<VoicePrefsStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    const { update: _u, ...cur } = get();
    const next = sanitizeVoicePrefs({ ...cur, ...patch });
    set(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not saved; applies for this session.
    }
  },
}));

/** Which engine speaks, given what is available right now. */
export function pickOutputEngine(pref: OutputEngine, serverOk: boolean, deviceOk: boolean): 'server' | 'device' | null {
  if (pref === 'server') return serverOk ? 'server' : null;
  if (pref === 'device') return deviceOk ? 'device' : null;
  return serverOk ? 'server' : deviceOk ? 'device' : null;
}

/** Which engine listens. Device recognition is only used once allowed. */
export function pickInputEngine(pref: InputEngine, serverOk: boolean, deviceOk: boolean, deviceAllowed: boolean): 'server' | 'device' | null {
  const device = deviceOk && deviceAllowed;
  if (pref === 'server') return serverOk ? 'server' : null;
  if (pref === 'device') return device ? 'device' : null;
  return serverOk ? 'server' : device ? 'device' : null;
}

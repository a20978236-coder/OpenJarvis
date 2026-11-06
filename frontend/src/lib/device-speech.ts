/**
 * The device's own speech features (Web Speech API).
 *  - Voices: speechSynthesis; on iPhone the system voices run on the phone.
 *  - Recognition: (webkit)SpeechRecognition; on iPhone this is Apple's
 *    speech service and audio may be processed on Apple's servers, so HELL
 *    only uses it after you allow it in Settings.
 */

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const deviceRecognitionSupported = () => recognitionCtor() !== null;
export const deviceVoicesSupported = () => typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';

const lang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

export function describeRecognitionError(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Speech recognition was not allowed. On iPhone: Settings › Screen Time › Content & Privacy › Allowed Apps (Siri & Dictation) and Settings › Safari › Microphone.';
  if (code === 'no-speech') return "Didn't hear anything.";
  if (code === 'network') return 'Speech recognition needs a connection to the device vendor (Apple/Google).';
  if (code === 'audio-capture') return 'The microphone is busy or unavailable.';
  return 'Speech recognition stopped.';
}

/**
 * One utterance: resolves with the final transcript when you stop talking
 * (or when `stop()` is called). `abort()` discards it.
 */
export function recognizeOnce(onInterim?: (text: string) => void): { result: Promise<string>; stop: () => void; abort: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject(new Error('Speech recognition is not supported here.')), stop: () => undefined, abort: () => undefined };
  const r = new Ctor();
  r.lang = lang();
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  let aborted = false;
  const result = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onInterim?.((finalText + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === 'aborted' || (e.error === 'no-speech' && !aborted)) return; // onend resolves
      reject(new Error(describeRecognitionError(e.error)));
    };
    r.onend = () => resolve(aborted ? '' : (finalText || interim).trim());
  });
  try {
    r.start();
  } catch (e) {
    return { result: Promise.reject(e instanceof Error ? e : new Error('Speech recognition failed to start.')), stop: () => undefined, abort: () => undefined };
  }
  return {
    result,
    stop: () => {
      try {
        r.stop();
      } catch {
        // already stopped
      }
    },
    abort: () => {
      aborted = true;
      try {
        r.abort();
      } catch {
        // already stopped
      }
    },
  };
}

// ---- Wake phrase ----------------------------------------------------------

/** "Hey HELL" / "Hi HELL" / "OK HELL" / "Hello HELL" (plus common mishearings). */
const WAKE = /\b(hey|hi|okay|ok|hello)[\s,.!]+(hell|hel|hal|hall|helle)\b[\s,.!?:-]*/i;

export function matchWakePhrase(transcript: string): { matched: boolean; remainder: string } {
  const m = WAKE.exec(transcript);
  if (!m) return { matched: false, remainder: '' };
  return { matched: true, remainder: transcript.slice(m.index + m[0].length).trim() };
}

/**
 * Listen for the wake phrase until stopped. Keeps restarting the
 * recogniser (browsers end it after a pause). Only for while the app is
 * open: iOS does not let a web app listen in the background or when locked.
 */
export function startWakeListener(onWake: (remainder: string) => void, onError: (msg: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onError('Speech recognition is not supported here.');
    return () => undefined;
  }
  let stopped = false;
  let r: RecognitionLike | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const run = () => {
    if (stopped) return;
    r = new Ctor();
    r.lang = lang();
    r.continuous = true;
    r.interimResults = true;
    let fired = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    r.onresult = (e) => {
      if (fired) return;
      let text = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        isFinal = isFinal || e.results[i].isFinal;
      }
      const m = matchWakePhrase(text);
      if (!m.matched) return;
      failures = 0;
      // Give a following command a moment ("Hey HELL, what's the time?").
      if (pending) clearTimeout(pending);
      const fire = () => {
        if (fired || stopped) return;
        fired = true;
        try {
          r?.abort();
        } catch {
          // ignore
        }
        onWake(m.remainder);
      };
      if (isFinal) fire();
      else pending = setTimeout(fire, 1200);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        stopped = true;
        onError(describeRecognitionError(e.error));
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        failures++;
      }
    };
    r.onend = () => {
      if (pending) clearTimeout(pending);
      if (stopped || fired) return;
      if (failures >= 5) {
        stopped = true;
        onError('The wake phrase stopped working (speech recognition kept failing).');
        return;
      }
      restartTimer = setTimeout(run, 250 + failures * 500);
    };
    try {
      r.start();
    } catch {
      failures++;
      restartTimer = setTimeout(run, 1000);
    }
  };
  run();
  return () => {
    stopped = true;
    if (restartTimer) clearTimeout(restartTimer);
    try {
      r?.abort();
    } catch {
      // ignore
    }
  };
}

// ---- Device voices --------------------------------------------------------

export interface DeviceVoice {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
}

export function listDeviceVoices(): DeviceVoice[] {
  if (!deviceVoicesSupported()) return [];
  const base = lang().split('-')[0];
  return speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(base.toLowerCase()))
    .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }))
    .sort((a, b) => Number(b.local) - Number(a.local) || a.name.localeCompare(b.name));
}

/** Voices load asynchronously in some browsers; resolve when known. */
export function loadDeviceVoices(timeoutMs = 1500): Promise<DeviceVoice[]> {
  if (!deviceVoicesSupported()) return Promise.resolve([]);
  const now = listDeviceVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener?.('voiceschanged', done);
      resolve(listDeviceVoices());
    };
    speechSynthesis.addEventListener?.('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
}

import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeakableText } from './message-text';

export type TtsState = 'idle' | 'loading' | 'speaking';

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;

/**
 * iOS Safari only lets an audio element play if it was first started from a
 * user gesture. Replies are spoken after a network round trip -- long after
 * the tap -- so a fresh `new Audio()` there is silently blocked. Instead, the
 * first tap plays a few milliseconds of silence on one element, and every
 * later utterance reuses that already-unlocked element.
 */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACA'
  + 'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg'
  + 'ICAgICAgICAgICAgICAgICAgICAgA==';
let unlockedEl: HTMLAudioElement | null = null;
let unlockInstalled = false;
let removeUnlockListeners: (() => void) | null = null;

/** Prime one audio element for playback; must run inside a user gesture. */
export function unlockAudioPlayback(): void {
  if (unlockedEl || typeof Audio === 'undefined') return;
  try {
    const el = new Audio(SILENT_WAV);
    const played = el.play();
    const markUnlocked = () => {
      el.pause();
      unlockedEl = el;
      removeUnlockListeners?.();
      removeUnlockListeners = null;
    };
    if (played && typeof played.then === 'function') {
      played.then(markUnlocked).catch(() => {
        // Gesture did not qualify; the next one will try again.
      });
    } else {
      markUnlocked();
    }
  } catch {
    // Audio unavailable; playback falls back to a fresh element per reply.
  }
}

/** Unlock audio on the first tap/click/key press anywhere in the app. */
export function installAudioUnlock(target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document): void {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const events = ['touchend', 'pointerup', 'keydown'] as const;
  // Listeners stay until an unlock actually succeeds, then remove themselves.
  const handler = () => unlockAudioPlayback();
  events.forEach((e) => target.addEventListener(e, handler, true));
  removeUnlockListeners = () => events.forEach((e) => target.removeEventListener(e, handler, true));
}

/** Element for the next utterance: the unlocked one when available. */
function playbackElement(url: string): HTMLAudioElement {
  if (unlockedEl) {
    unlockedEl.src = url;
    return unlockedEl;
  }
  return new Audio(url);
}

/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function teardown(): void {
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: async (id: string, text: string) => {
    const trimmed = toSpeakableText(text);
    if (!trimmed) return;

    // Bump before teardown so a synthesis still in flight is both aborted and
    // fenced off by the token, even if the abort loses the race.
    token += 1;
    const mine = token;
    teardown();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;

    try {
      const blob = await synthesizeSpeech(trimmed, { signal: ac.signal });
      if (mine !== token) return;

      const url = URL.createObjectURL(blob);
      objectUrl = url;
      const el = playbackElement(url);
      audio = el;

      el.onended = () => {
        if (mine !== token) return;
        teardown();
        set({ state: 'idle', speakingId: null });
      };
      el.onerror = () => {
        if (mine !== token) return;
        teardown();
        set({ state: 'idle', speakingId: null, error: 'Playback failed', errorId: id });
      };

      await el.play();
      if (mine === token) set({ state: 'speaking', speakingId: id });
    } catch (err) {
      if (mine !== token) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      teardown();
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: id,
      });
    }
  },

  stop: () => {
    token += 1;
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  teardown();
  token = 0;
  healthProbe = null;
  unlockedEl = null;
  unlockInstalled = false;
  removeUnlockListeners?.();
  removeUnlockListeners = null;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}

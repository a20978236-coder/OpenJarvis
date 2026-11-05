/**
 * Camera hand gestures (Stage G): pure logic, unit-tested.
 *
 * MediaPipe's gesture recogniser labels each video frame; this turns that
 * noisy per-frame stream into deliberate commands:
 *  - a gesture must be HELD (seen continuously) for `holdMs`;
 *  - each one fires once, then the hand must change or leave before the
 *    same gesture can fire again;
 *  - a cooldown separates any two commands;
 *  - single-frame dropouts (`graceMs`) don't restart the hold.
 */

export type HandGesture = 'open-palm' | 'fist' | 'thumbs-up' | 'thumbs-down' | 'two-fingers';

export const HAND_GESTURES: HandGesture[] = ['open-palm', 'fist', 'thumbs-up', 'thumbs-down', 'two-fingers'];

/** MediaPipe category names → ours. Pointing_Up / ILoveYou / None are ignored. */
const CATEGORY: Record<string, HandGesture> = {
  Open_Palm: 'open-palm',
  Closed_Fist: 'fist',
  Thumb_Up: 'thumbs-up',
  Thumb_Down: 'thumbs-down',
  Victory: 'two-fingers',
};

export const HAND_LABELS: Record<HandGesture, string> = {
  'open-palm': 'Open palm',
  fist: 'Closed fist',
  'thumbs-up': 'Thumbs up',
  'thumbs-down': 'Thumbs down',
  'two-fingers': 'Two fingers',
};

export const HAND_ACTIONS: Record<HandGesture, string> = {
  'open-palm': 'Activate HELL (start listening)',
  fist: 'Pause (stop speaking and listening)',
  'thumbs-up': 'Confirm (send what you said)',
  'thumbs-down': 'Cancel (discard / stop)',
  'two-fingers': 'Open Vision',
};

export function toHandGesture(category: string | undefined, score: number, minScore: number): HandGesture | null {
  if (!category || !(score >= minScore)) return null;
  return CATEGORY[category] ?? null;
}

export interface StabilizerOptions {
  holdMs: number;
  cooldownMs: number;
  graceMs: number;
}

export const DEFAULT_STABILIZER: StabilizerOptions = { holdMs: 600, cooldownMs: 1500, graceMs: 200 };

export interface StabilizerFrame {
  /** Fired this frame (at most once per hold). */
  fired: HandGesture | null;
  /** Being held right now (for the on-screen progress ring). */
  holding: HandGesture | null;
  /** 0..1 of the hold time; 0 while latched or cooling down. */
  progress: number;
}

export function createStabilizer(options: () => StabilizerOptions) {
  let cur: HandGesture | null = null;
  let since = 0;
  let lastSeen = -Infinity;
  let latched: HandGesture | null = null;
  let lastFire = -Infinity;

  return {
    feed(g: HandGesture | null, t: number): StabilizerFrame {
      const o = options();
      if (g === null) {
        if (cur !== null && t - lastSeen <= o.graceMs) g = cur; // brief dropout
        else {
          cur = null;
          latched = null; // hand left or relaxed: the same gesture may fire again
          return { fired: null, holding: null, progress: 0 };
        }
      } else {
        lastSeen = t;
      }
      if (g !== cur) {
        cur = g;
        since = t;
        if (latched !== g) latched = null;
      }
      if (latched === g) return { fired: null, holding: g, progress: 0 };
      const cooling = t - lastFire < o.cooldownMs;
      const progress = cooling ? 0 : Math.min(1, (t - since) / o.holdMs);
      if (cooling) since = Math.max(since, t - 1); // hold starts after the cooldown
      if (progress >= 1) {
        latched = g;
        lastFire = t;
        return { fired: g, holding: g, progress: 1 };
      }
      return { fired: null, holding: g, progress };
    },
    reset() {
      cur = null;
      latched = null;
      lastSeen = -Infinity;
    },
  };
}

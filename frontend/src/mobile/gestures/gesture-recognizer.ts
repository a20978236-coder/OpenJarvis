/**
 * Touchscreen gesture recognition (pure: no DOM, clock passed in).
 *
 * Recognises swipes (4 directions), pinch in/out, double tap and long press
 * from raw pointer data. Guards against accidental activation:
 *  - a swipe needs a minimum distance, a minimum speed, a maximum duration
 *    and one clearly dominant direction (diagonals are ignored);
 *  - swipes starting next to the top/bottom screen edge are ignored (iOS
 *    uses those for Notification Center and the home indicator);
 *  - three or more fingers, or a pinch that also scrolls, cancel everything;
 *  - each gesture is only reported once, when the fingers lift.
 */

export type GestureName =
  | 'swipe-up'
  | 'swipe-down'
  | 'swipe-left'
  | 'swipe-right'
  | 'double-tap'
  | 'long-press'
  | 'pinch-out'
  | 'pinch-in';

export const GESTURE_NAMES: GestureName[] = ['swipe-up', 'swipe-down', 'swipe-left', 'swipe-right', 'double-tap', 'long-press', 'pinch-out', 'pinch-in'];

export interface RecognizerOptions {
  /** Minimum travel for a swipe, in CSS px. */
  swipeDistance: number;
  /** A swipe must finish within this many ms (slow drags are not swipes). */
  swipeMaxMs: number;
  /** Minimum average speed for a swipe, px/ms. */
  minVelocity: number;
  /** The main direction must be this many times longer than the other. */
  dominance: number;
  /** Pinch: finger distance must change by this fraction (0.25 = 25%). */
  pinchRatio: number;
  /** Movement allowed for a tap / long press, px. */
  tapTolerance: number;
  doubleTapMs: number;
  longPressMs: number;
  /** Ignore swipes that start this close to the top or bottom edge, px. */
  edgeGuard: number;
  viewportHeight: number;
}

export const DEFAULT_RECOGNIZER: RecognizerOptions = {
  swipeDistance: 70,
  swipeMaxMs: 700,
  minVelocity: 0.25,
  dominance: 1.6,
  pinchRatio: 0.25,
  tapTolerance: 12,
  doubleTapMs: 300,
  longPressMs: 600,
  edgeGuard: 24,
  viewportHeight: 844,
};

/** What a pointer that starts here may turn into. */
export interface Allow {
  /** Double tap / long press. */
  press: boolean;
  /** Left / right swipes. */
  horizontal: boolean;
  /** Up / down swipes. */
  vertical: boolean;
  pinch: boolean;
}

export const ALLOW_NONE: Allow = { press: false, horizontal: false, vertical: false, pinch: false };

interface Pt {
  sx: number;
  sy: number;
  x: number;
  y: number;
  t0: number;
}

export interface GestureRecognizer {
  down(id: number, x: number, y: number, t: number, allow: Allow): void;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number, t: number): void;
  cancel(id: number): void;
  dispose(): void;
}

/**
 * `emit` is called once per recognised gesture. `schedule` lets tests drive
 * the long-press timer; it defaults to setTimeout.
 */
export function createGestureRecognizer(
  options: () => RecognizerOptions,
  emit: (g: GestureName) => void,
  schedule: (fn: () => void, ms: number) => () => void = (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
): GestureRecognizer {
  const pts = new Map<number, Pt>();
  let mode: 'idle' | 'single' | 'pinch' | 'dead' = 'idle';
  let allow: Allow = ALLOW_NONE;
  let moved = false;
  let longFired = false;
  let cancelLong: (() => void) | null = null;
  let pinchStart = 0;
  let pinchNow = 0;
  let lastTap: { t: number; x: number; y: number } | null = null;

  const stopLong = () => {
    cancelLong?.();
    cancelLong = null;
  };
  const dist = () => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const reset = () => {
    stopLong();
    pts.clear();
    mode = 'idle';
    allow = ALLOW_NONE;
    moved = false;
    longFired = false;
  };

  function swipe(p: Pt, t: number): GestureName | null {
    const o = options();
    const dx = p.x - p.sx;
    const dy = p.y - p.sy;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const dt = Math.max(1, t - p.t0);
    if (dt > o.swipeMaxMs) return null;
    const d = Math.max(ax, ay);
    if (d < o.swipeDistance || d / dt < o.minVelocity) return null;
    if (ax >= ay * o.dominance && allow.horizontal) return dx < 0 ? 'swipe-left' : 'swipe-right';
    if (ay >= ax * o.dominance && allow.vertical) {
      const nearEdge = p.sy < o.edgeGuard || p.sy > o.viewportHeight - o.edgeGuard;
      if (nearEdge) return null;
      return dy < 0 ? 'swipe-up' : 'swipe-down';
    }
    return null;
  }

  return {
    down(id, x, y, t, a) {
      if (mode === 'idle') {
        pts.set(id, { sx: x, sy: y, x, y, t0: t });
        mode = 'single';
        allow = a;
        moved = false;
        longFired = false;
        if (allow.press) {
          cancelLong = schedule(() => {
            cancelLong = null;
            if (mode !== 'single' || moved) return;
            longFired = true;
            lastTap = null;
            emit('long-press');
          }, options().longPressMs);
        }
        return;
      }
      pts.set(id, { sx: x, sy: y, x, y, t0: t });
      stopLong();
      lastTap = null;
      if (mode === 'single' && pts.size === 2 && allow.pinch && !longFired) {
        mode = 'pinch';
        pinchStart = pinchNow = dist();
      } else {
        mode = 'dead';
      }
    },

    move(id, x, y) {
      const p = pts.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      if (mode === 'single' && !moved && Math.hypot(x - p.sx, y - p.sy) > options().tapTolerance) {
        moved = true;
        stopLong();
      } else if (mode === 'pinch') {
        pinchNow = dist();
      }
    },

    up(id, x, y, t) {
      const p = pts.get(id);
      if (!p) return;
      p.x = x;
      p.y = y;
      const o = options();
      if (mode === 'single') {
        if (Math.hypot(x - p.sx, y - p.sy) > o.tapTolerance) moved = true;
        if (moved) {
          const g = swipe(p, t);
          lastTap = null;
          if (g) emit(g);
        } else if (!longFired && allow.press) {
          // The gap that matters is first lift -> second touch-down.
          if (lastTap && p.t0 - lastTap.t <= o.doubleTapMs && Math.hypot(x - lastTap.x, y - lastTap.y) <= o.tapTolerance * 3) {
            lastTap = null;
            emit('double-tap');
          } else {
            lastTap = { t, x, y };
          }
        }
        reset();
        return;
      }
      if (mode === 'pinch') {
        pinchNow = dist();
        const ratio = pinchStart > 0 ? pinchNow / pinchStart : 1;
        mode = 'dead';
        if (ratio >= 1 + o.pinchRatio) emit('pinch-out');
        else if (ratio <= 1 / (1 + o.pinchRatio)) emit('pinch-in');
      }
      pts.delete(id);
      if (pts.size === 0) reset();
    },

    cancel(id) {
      pts.delete(id);
      stopLong();
      lastTap = null;
      if (pts.size === 0) reset();
      else mode = 'dead';
    },

    dispose() {
      reset();
      lastTap = null;
    },
  };
}

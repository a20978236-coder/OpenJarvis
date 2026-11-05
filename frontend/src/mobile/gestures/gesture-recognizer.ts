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

export interface StrokeResult {
  gesture: GestureName | null;
  /** Why it was not a gesture (plain words), or '' when it was. */
  reason: string;
  /** Travel along the main direction, px. */
  distance: number;
  ms: number;
  /** px per ms. */
  speed: number;
}

export type Observation =
  | ({ kind: 'swipe' } & StrokeResult)
  | { kind: 'tap'; gapMs: number | null; gesture: GestureName | null }
  | { kind: 'pinch'; ratio: number; gesture: GestureName | null; reason: string };

/** Is one finger's stroke a swipe? Pure; also explains a rejection. */
export function evaluateStroke(dx: number, dy: number, dtMs: number, startY: number, o: RecognizerOptions, allow: Allow): StrokeResult {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const ms = Math.max(1, Math.round(dtMs));
  const distance = Math.round(Math.max(ax, ay));
  const speed = distance / ms;
  const out = (gesture: GestureName | null, reason: string): StrokeResult => ({ gesture, reason, distance, ms, speed });
  if (ms > o.swipeMaxMs) return out(null, `too slow: ${ms} ms, limit ${o.swipeMaxMs} ms`);
  if (distance < o.swipeDistance) return out(null, `too short: ${distance} px, needs ${o.swipeDistance} px`);
  if (speed < o.minVelocity) return out(null, `not fast enough: ${speed.toFixed(2)} px/ms, needs ${o.minVelocity.toFixed(2)}`);
  if (ax >= ay * o.dominance) {
    if (!allow.horizontal) return out(null, 'sideways swipes are off here');
    return out(dx < 0 ? 'swipe-left' : 'swipe-right', '');
  }
  if (ay >= ax * o.dominance) {
    if (!allow.vertical) return out(null, 'up/down swipes are off here');
    if (startY < o.edgeGuard || startY > o.viewportHeight - o.edgeGuard) return out(null, 'started at the screen edge (iOS uses it)');
    return out(dy < 0 ? 'swipe-up' : 'swipe-down', '');
  }
  return out(null, 'too diagonal');
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
  /** Optional: every finished stroke, tap and pinch with its numbers (live testing). */
  observe?: (o: Observation) => void,
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
    const r = evaluateStroke(p.x - p.sx, p.y - p.sy, t - p.t0, p.sy, options(), allow);
    observe?.({ kind: 'swipe', ...r });
    return r.gesture;
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
          const gap = lastTap && Math.hypot(x - lastTap.x, y - lastTap.y) <= o.tapTolerance * 3 ? p.t0 - lastTap.t : null;
          if (gap !== null && gap <= o.doubleTapMs) {
            lastTap = null;
            observe?.({ kind: 'tap', gapMs: gap, gesture: 'double-tap' });
            emit('double-tap');
          } else {
            lastTap = { t, x, y };
            observe?.({ kind: 'tap', gapMs: gap, gesture: null });
          }
        }
        reset();
        return;
      }
      if (mode === 'pinch') {
        pinchNow = dist();
        const ratio = pinchStart > 0 ? pinchNow / pinchStart : 1;
        mode = 'dead';
        const g: GestureName | null = ratio >= 1 + o.pinchRatio ? 'pinch-out' : ratio <= 1 / (1 + o.pinchRatio) ? 'pinch-in' : null;
        observe?.({ kind: 'pinch', ratio, gesture: g, reason: g ? '' : `fingers moved ${Math.round(Math.abs(ratio - 1) * 100)}%, needs ${Math.round(o.pinchRatio * 100)}%` });
        if (g) emit(g);
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

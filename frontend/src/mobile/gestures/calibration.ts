/**
 * Gesture training: HELL watches a few of your natural swipes and double
 * taps and suggests thresholds that fit them, with a safety margin. Pure
 * functions, so the maths is unit-tested.
 */
import { DEFAULT_RECOGNIZER, type GestureName } from './gesture-recognizer';
import { TUNING_LIMITS, type Tuning } from './gesture-settings';

export type TrainGesture = 'swipe-left' | 'swipe-right' | 'swipe-up' | 'swipe-down' | 'double-tap';

/** The visual training run: each direction twice, then two double taps. */
export const TRAINING_STEPS: TrainGesture[] = [
  'swipe-left',
  'swipe-left',
  'swipe-right',
  'swipe-right',
  'swipe-up',
  'swipe-up',
  'swipe-down',
  'swipe-down',
  'double-tap',
  'double-tap',
];

export interface SwipeSample {
  want: TrainGesture;
  dx: number;
  dy: number;
  ms: number;
}

/** Below this a stroke is too small to learn from (likely a slip). */
const MIN_SAMPLE_PX = 30;

function direction(dx: number, dy: number): GestureName | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < MIN_SAMPLE_PX) return null;
  if (ax >= ay * 1.2) return dx < 0 ? 'swipe-left' : 'swipe-right';
  if (ay >= ax * 1.2) return dy < 0 ? 'swipe-up' : 'swipe-down';
  return null;
}

const SAY: Record<string, string> = {
  'swipe-left': 'left',
  'swipe-right': 'right',
  'swipe-up': 'up',
  'swipe-down': 'down',
};

/** Was this stroke the swipe we asked for? A plain reason if not. */
export function checkSwipeSample(want: TrainGesture, dx: number, dy: number): { ok: boolean; reason: string } {
  const got = direction(dx, dy);
  if (!got) {
    const d = Math.round(Math.max(Math.abs(dx), Math.abs(dy)));
    return { ok: false, reason: d < MIN_SAMPLE_PX ? 'That was too small — swipe a bit further.' : 'That went diagonally — try a straighter swipe.' };
  }
  if (got !== want) return { ok: false, reason: `That went ${SAY[got]} — swipe ${SAY[want]}.` };
  return { ok: true, reason: '' };
}

const clampTo = (k: keyof Tuning, v: number) => Math.min(TUNING_LIMITS[k][1], Math.max(TUNING_LIMITS[k][0], v));
const round = (v: number, step: number) => Math.round(v / step) * step;
const D = DEFAULT_RECOGNIZER;

/**
 * Suggested thresholds from your samples. Only distance (what stops slips and
 * scrolls from counting) may get stricter; timing and speed only ever loosen,
 * because fast training swipes must not make relaxed ones fail later.
 *  - distance: 60% of your shortest swipe (so all of yours count, slips don't);
 *  - time limit: 2x your slowest swipe, never below the default;
 *  - speed needed: 40% of your slowest speed, never above the default;
 *  - straightness: 60% of your least straight swipe, never above the default;
 *  - double-tap window: 1.6x your slowest gap, never below the default.
 * Everything stays inside TUNING_LIMITS. Values without samples are kept.
 */
export function suggestTuning(swipes: SwipeSample[], tapGaps: number[], current: Tuning): Tuning {
  const next: Tuning = { ...current };
  const good = swipes.filter((s) => checkSwipeSample(s.want, s.dx, s.dy).ok && s.ms > 0);
  if (good.length) {
    const along = good.map((s) => Math.max(Math.abs(s.dx), Math.abs(s.dy)));
    const cross = good.map((s) => Math.min(Math.abs(s.dx), Math.abs(s.dy)));
    const ms = good.map((s) => s.ms);
    const speeds = good.map((s, i) => along[i] / s.ms);
    const straight = good.map((_, i) => along[i] / Math.max(1, cross[i]));
    next.swipeDistance = clampTo('swipeDistance', round(Math.min(...along) * 0.6, 5));
    next.swipeMaxMs = clampTo('swipeMaxMs', Math.max(D.swipeMaxMs, round(Math.max(...ms) * 2, 50)));
    next.minVelocity = clampTo('minVelocity', Math.min(D.minVelocity, round(Math.min(...speeds) * 0.4, 0.05)));
    next.dominance = clampTo('dominance', Math.min(D.dominance, round(Math.min(...straight) * 0.6, 0.1)));
  }
  const gaps = tapGaps.filter((g) => Number.isFinite(g) && g > 0);
  if (gaps.length) next.doubleTapMs = clampTo('doubleTapMs', Math.max(D.doubleTapMs, round(Math.max(...gaps) * 1.6, 10)));
  // Floating-point tidy-up for display.
  next.minVelocity = Math.round(next.minVelocity * 100) / 100;
  next.dominance = Math.round(next.dominance * 10) / 10;
  return next;
}

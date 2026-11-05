import { describe, expect, it } from 'vitest';
import { checkSwipeSample, suggestTuning, TRAINING_STEPS, type SwipeSample } from './calibration';
import { DEFAULT_RECOGNIZER, evaluateStroke, type Allow } from './gesture-recognizer';
import { DEFAULT_SETTINGS, effectiveAction, sanitizeSettings, TUNING_LIMITS } from './gesture-settings';

const ALL: Allow = { press: true, horizontal: true, vertical: true, pinch: true };
const O = { ...DEFAULT_RECOGNIZER, viewportHeight: 800 };
const cur = DEFAULT_SETTINGS.tuning;

describe('evaluateStroke explains itself', () => {
  it('accepts a good swipe and reports its numbers', () => {
    const r = evaluateStroke(-180, 10, 150, 400, O, ALL);
    expect(r).toMatchObject({ gesture: 'swipe-left', reason: '', distance: 180, ms: 150 });
    expect(r.speed).toBeCloseTo(1.2);
  });
  it.each([
    [40, 0, 100, 400, /too short: 40 px, needs 70 px/],
    [200, 0, 900, 400, /too slow: 900 ms/],
    [100, 0, 600, 400, /not fast enough/],
    [100, 90, 150, 400, /too diagonal/],
    [0, -200, 150, 790, /screen edge/],
  ])('rejects %s,%s in %sms', (dx, dy, ms, y, re) => {
    const r = evaluateStroke(dx, dy, ms, y, O, ALL);
    expect(r.gesture).toBeNull();
    expect(r.reason).toMatch(re);
  });
  it('says when a direction is off in this place', () => {
    expect(evaluateStroke(0, -200, 150, 400, O, { ...ALL, vertical: false }).reason).toMatch(/up\/down swipes are off/);
  });
});

describe('training samples', () => {
  it('runs each direction twice, then double taps', () => {
    expect(TRAINING_STEPS.filter((s) => s === 'swipe-left')).toHaveLength(2);
    expect(TRAINING_STEPS.slice(-2)).toEqual(['double-tap', 'double-tap']);
  });
  it('checks the direction and size of a sample', () => {
    expect(checkSwipeSample('swipe-left', -150, 10).ok).toBe(true);
    expect(checkSwipeSample('swipe-left', 150, 10).reason).toBe('That went right — swipe left.');
    expect(checkSwipeSample('swipe-up', 0, -12).reason).toMatch(/too small/);
    expect(checkSwipeSample('swipe-up', 100, -100).reason).toMatch(/diagonally/);
  });
});

describe('suggestTuning', () => {
  const sample = (want: SwipeSample['want'], dx: number, dy: number, ms: number): SwipeSample => ({ want, dx, dy, ms });

  it('fits short, gentle swipes with a margin', () => {
    const swipes = [sample('swipe-left', -90, 8, 220), sample('swipe-right', 110, -5, 260), sample('swipe-up', 6, -100, 240), sample('swipe-down', -4, 95, 200)];
    const t = suggestTuning(swipes, [210, 260], cur);
    expect(t.swipeDistance).toBe(55); // 60% of 90
    expect(t.swipeMaxMs).toBe(700); // 2 x 260 = 520, but never below the default 700
    expect(t.minVelocity).toBeCloseTo(0.15); // 40% of 90/220=0.41
    expect(t.doubleTapMs).toBe(420); // 1.6 x 260
    // Untouched by training.
    expect(t.longPressMs).toBe(cur.longPressMs);
    expect(t.pinchRatio).toBe(cur.pinchRatio);
  });

  it('never goes outside the safe limits (no hair-trigger)', () => {
    const tiny = [sample('swipe-left', -35, 0, 40), sample('swipe-up', 0, -35, 40)];
    const t = suggestTuning(tiny, [20], cur);
    expect(t.swipeDistance).toBeGreaterThanOrEqual(TUNING_LIMITS.swipeDistance[0]);
    expect(t.swipeMaxMs).toBeGreaterThanOrEqual(TUNING_LIMITS.swipeMaxMs[0]);
    expect(t.doubleTapMs).toBeGreaterThanOrEqual(TUNING_LIMITS.doubleTapMs[0]);
    const huge = [sample('swipe-left', -600, 0, 3000), sample('swipe-up', 5, -600, 900)];
    const h = suggestTuning(huge, [5000], cur);
    expect(h.swipeDistance).toBeLessThanOrEqual(TUNING_LIMITS.swipeDistance[1]);
    expect(h.swipeMaxMs).toBeLessThanOrEqual(TUNING_LIMITS.swipeMaxMs[1]);
    expect(h.doubleTapMs).toBeLessThanOrEqual(TUNING_LIMITS.doubleTapMs[1]);
  });

  it('fast training never makes timing or speed stricter than the defaults', () => {
    const fast = [sample('swipe-left', -150, 0, 60), sample('swipe-up', 0, -150, 50)];
    const t = suggestTuning(fast, [60], cur);
    expect(t.swipeMaxMs).toBeGreaterThanOrEqual(cur.swipeMaxMs);
    expect(t.minVelocity).toBeLessThanOrEqual(cur.minVelocity);
    expect(t.doubleTapMs).toBeGreaterThanOrEqual(cur.doubleTapMs);
    expect(t.dominance).toBeLessThanOrEqual(cur.dominance);
    // Distance can tighten: 60% of 150.
    expect(t.swipeDistance).toBe(90);
  });

  it('ignores wrong-direction samples and keeps values it has no data for', () => {
    const t = suggestTuning([sample('swipe-left', 200, 0, 100)], [], cur);
    expect(t).toEqual(cur);
  });

  it('a suggestion still recognises every training swipe', () => {
    const swipes = [sample('swipe-left', -90, 8, 220), sample('swipe-right', 140, 30, 300), sample('swipe-up', 12, -120, 180), sample('swipe-down', -4, 95, 200)];
    const t = suggestTuning(swipes, [], cur);
    for (const s of swipes) expect(evaluateStroke(s.dx, s.dy, s.ms, 400, { ...O, ...t }, ALL).gesture).toBe(s.want);
  });
});

describe('handedness and saved settings', () => {
  it('left-handed mode swaps swipe left and right only', () => {
    const s = { map: DEFAULT_SETTINGS.map, hand: 'left' as const };
    expect(effectiveAction(s, 'swipe-left')).toBe('next-module');
    expect(effectiveAction(s, 'swipe-right')).toBe('prev-module');
    expect(effectiveAction(s, 'swipe-up')).toBe('open-hell');
    expect(effectiveAction({ ...s, hand: 'right' }, 'swipe-left')).toBe('prev-module');
  });
  it('sanitizes hand and the new tunables', () => {
    const s = sanitizeSettings({ hand: 'both', tuning: { minVelocity: 0, dominance: 9 } });
    expect(s.hand).toBe('right');
    expect(s.tuning.minVelocity).toBe(TUNING_LIMITS.minVelocity[0]);
    expect(s.tuning.dominance).toBe(TUNING_LIMITS.dominance[1]);
    expect(sanitizeSettings({ hand: 'left' }).hand).toBe('left');
  });
});

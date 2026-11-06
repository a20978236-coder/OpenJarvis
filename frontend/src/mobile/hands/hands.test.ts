import { describe, expect, it } from 'vitest';
import { createStabilizer, DEFAULT_STABILIZER, toHandGesture, type HandGesture } from './hand-logic';
import { HAND_LIMITS, sanitizeHandSettings } from './hand-store';
import { isMediaPipeTelemetry } from './hand-tracker';

const opts = () => DEFAULT_STABILIZER; // hold 600, cooldown 1500, grace 200

/** Feed one label every `step` ms from t0 for `ms`; return what fired. */
function run(stab: ReturnType<typeof createStabilizer>, g: HandGesture | null, t0: number, ms: number, step = 100) {
  const fired: HandGesture[] = [];
  let t = t0;
  for (; t <= t0 + ms; t += step) {
    const r = stab.feed(g, t);
    if (r.fired) fired.push(r.fired);
  }
  return { fired, t };
}

describe('toHandGesture', () => {
  it('maps MediaPipe names and ignores the rest', () => {
    expect(toHandGesture('Open_Palm', 0.9, 0.6)).toBe('open-palm');
    expect(toHandGesture('Closed_Fist', 0.9, 0.6)).toBe('fist');
    expect(toHandGesture('Thumb_Up', 0.9, 0.6)).toBe('thumbs-up');
    expect(toHandGesture('Thumb_Down', 0.9, 0.6)).toBe('thumbs-down');
    expect(toHandGesture('Victory', 0.9, 0.6)).toBe('two-fingers');
    expect(toHandGesture('Pointing_Up', 0.99, 0.6)).toBeNull();
    expect(toHandGesture('ILoveYou', 0.99, 0.6)).toBeNull();
    expect(toHandGesture('None', 0.99, 0.6)).toBeNull();
    expect(toHandGesture(undefined, 1, 0.6)).toBeNull();
  });
  it('needs enough confidence', () => {
    expect(toHandGesture('Victory', 0.55, 0.6)).toBeNull();
    expect(toHandGesture('Victory', Number.NaN, 0.6)).toBeNull();
  });
});

describe('stabilizer', () => {
  it('fires only after the hold time, once per hold', () => {
    const s = createStabilizer(opts);
    expect(s.feed('thumbs-up', 0).fired).toBeNull();
    expect(s.feed('thumbs-up', 300).progress).toBeCloseTo(0.5);
    expect(s.feed('thumbs-up', 500).fired).toBeNull();
    expect(s.feed('thumbs-up', 600).fired).toBe('thumbs-up');
    // Still holding: never repeats.
    expect(run(s, 'thumbs-up', 700, 5000).fired).toEqual([]);
  });

  it('a quick flash of a sign does nothing', () => {
    const s = createStabilizer(opts);
    expect(run(s, 'fist', 0, 300).fired).toEqual([]);
    expect(run(s, null, 400, 1000).fired).toEqual([]);
  });

  it('a single dropped frame does not restart the hold', () => {
    const s = createStabilizer(opts);
    s.feed('open-palm', 0);
    s.feed('open-palm', 300);
    s.feed(null, 400); // within 200 ms grace of the last sighting
    expect(s.feed('open-palm', 600).fired).toBe('open-palm');
  });

  it('a real gap restarts it', () => {
    const s = createStabilizer(opts);
    s.feed('open-palm', 0);
    s.feed('open-palm', 300);
    s.feed(null, 600); // 300 ms without a hand
    expect(s.feed('open-palm', 700).fired).toBeNull();
    expect(s.feed('open-palm', 1300).fired).toBe('open-palm');
  });

  it('the same sign fires again after the hand leaves and the cooldown passes', () => {
    const s = createStabilizer(opts);
    expect(run(s, 'thumbs-up', 0, 700).fired).toEqual(['thumbs-up']);
    run(s, null, 800, 300);
    // Back within the cooldown (fired at 600; cooldown 1500 -> 2100).
    expect(run(s, 'thumbs-up', 1200, 800).fired).toEqual([]);
    expect(run(s, 'thumbs-up', 2100, 800).fired).toEqual(['thumbs-up']);
  });

  it('changing sign needs its own full hold after the cooldown', () => {
    const s = createStabilizer(opts);
    expect(run(s, 'thumbs-up', 0, 700).fired).toEqual(['thumbs-up']);
    const r = run(s, 'thumbs-down', 800, 1200);
    expect(r.fired).toEqual([]); // still cooling down until 2100, then holding
    expect(run(s, 'thumbs-down', 2100, 700).fired).toEqual(['thumbs-down']);
  });

  it('progress shows while holding, zero while latched', () => {
    const s = createStabilizer(opts);
    run(s, 'two-fingers', 0, 700);
    expect(s.feed('two-fingers', 800)).toMatchObject({ holding: 'two-fingers', progress: 0, fired: null });
  });
});

describe('hand settings', () => {
  it('sanitizes and clamps', () => {
    expect(sanitizeHandSettings(null)).toEqual({ holdMs: 600, minScore: 0.6, idleOffSec: 90 });
    const s = sanitizeHandSettings({ holdMs: 10, minScore: 2, idleOffSec: 'x' });
    expect(s.holdMs).toBe(HAND_LIMITS.holdMs[0]);
    expect(s.minScore).toBe(HAND_LIMITS.minScore[1]);
    expect(s.idleOffSec).toBe(90);
  });
});

describe('privacy', () => {
  it('recognises MediaPipe usage-logging requests (refused before they leave)', () => {
    expect(isMediaPipeTelemetry('https://odml.pa.googleapis.com/v1/log')).toBe(true);
    expect(isMediaPipeTelemetry('/mediapipe/gesture_recognizer.task')).toBe(false);
    expect(isMediaPipeTelemetry('https://example.com/odml.pa.googleapis.com')).toBe(false);
  });
});

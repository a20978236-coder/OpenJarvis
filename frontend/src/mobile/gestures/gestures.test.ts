import { beforeEach, describe, expect, it } from 'vitest';
import { createGestureRecognizer, DEFAULT_RECOGNIZER, type Allow, type GestureName } from './gesture-recognizer';
import { carousel, carouselIndex, DEFAULT_MAP, sanitizeSettings, stepCarousel } from './gesture-settings';

const ALL: Allow = { press: true, horizontal: true, vertical: true, pinch: true };

function setup(opts = {}) {
  const got: GestureName[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const rec = createGestureRecognizer(
    () => ({ ...DEFAULT_RECOGNIZER, viewportHeight: 800, ...opts }),
    (g) => got.push(g),
    (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => (t.live = false);
    },
  );
  const fire = () => timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn()));
  /** One finger from (x0,y0) to (x1,y1) over `ms`. */
  const drag = (x0: number, y0: number, x1: number, y1: number, ms: number, t0 = 0, allow = ALL) => {
    rec.down(1, x0, y0, t0, allow);
    for (let i = 1; i <= 5; i++) rec.move(1, x0 + ((x1 - x0) * i) / 5, y0 + ((y1 - y0) * i) / 5);
    rec.up(1, x1, y1, t0 + ms);
  };
  const tap = (x: number, y: number, t: number, allow = ALL) => {
    rec.down(1, x, y, t, allow);
    rec.up(1, x, y, t + 60);
  };
  return { rec, got, fire, drag, tap };
}

describe('swipes', () => {
  it('recognises all four directions', () => {
    const { got, drag } = setup();
    drag(200, 400, 200, 250, 200);
    drag(200, 300, 200, 450, 200);
    drag(300, 400, 150, 400, 200);
    drag(100, 400, 260, 400, 200);
    expect(got).toEqual(['swipe-up', 'swipe-down', 'swipe-left', 'swipe-right']);
  });

  it('ignores short, slow and diagonal movement', () => {
    const { got, drag } = setup();
    drag(200, 400, 200, 360, 120); // 40px < 70px
    drag(200, 400, 200, 200, 1200); // too slow (over swipeMaxMs)
    drag(100, 400, 220, 300, 200); // diagonal: 120 vs 100
    expect(got).toEqual([]);
  });

  it('respects the configured distance', () => {
    const { got, drag } = setup({ swipeDistance: 150 });
    drag(200, 400, 200, 280, 150);
    expect(got).toEqual([]);
    drag(200, 500, 200, 300, 200);
    expect(got).toEqual(['swipe-up']);
  });

  it('ignores vertical swipes from the iOS screen edges', () => {
    const { got, drag } = setup();
    drag(200, 790, 200, 500, 200); // home indicator
    drag(200, 5, 200, 300, 200); // notification center
    drag(200, 700, 200, 500, 200);
    expect(got).toEqual(['swipe-up']);
  });

  it('only reports the directions this spot allows', () => {
    const { got, drag } = setup();
    const horizOnly: Allow = { press: false, horizontal: true, vertical: false, pinch: false };
    drag(200, 500, 200, 300, 200, 0, horizOnly);
    drag(300, 400, 120, 400, 200, 0, horizOnly);
    expect(got).toEqual(['swipe-left']);
  });

  it('a swipe never also counts as a tap or long press', () => {
    const { got, drag, fire } = setup();
    drag(200, 500, 200, 300, 200);
    fire();
    expect(got).toEqual(['swipe-up']);
  });
});

describe('taps and presses', () => {
  it('double tap needs two quick taps in the same place', () => {
    const { got, tap } = setup();
    tap(100, 100, 0);
    tap(102, 101, 200);
    expect(got).toEqual(['double-tap']);
    tap(100, 100, 1000);
    tap(100, 100, 1400); // 340ms gap: too slow
    tap(100, 100, 3000);
    tap(260, 100, 3100); // too far apart
    expect(got).toEqual(['double-tap']);
  });

  it('measures the gap between taps, not their length', () => {
    const { rec, got } = setup();
    rec.down(1, 100, 100, 0, ALL);
    rec.up(1, 100, 100, 140); // slow first tap
    rec.down(1, 100, 100, 370, ALL); // 230ms later
    rec.up(1, 100, 100, 520);
    expect(got).toEqual(['double-tap']);
  });

  it('long press fires while held, and not after release', () => {
    const { rec, got, fire } = setup();
    rec.down(1, 50, 50, 0, ALL);
    fire();
    rec.up(1, 50, 50, 700);
    expect(got).toEqual(['long-press']);
    rec.down(1, 50, 50, 1000, ALL);
    rec.up(1, 50, 50, 1100);
    fire();
    expect(got).toEqual(['long-press']);
  });

  it('moving cancels the long press', () => {
    const { rec, got, fire } = setup();
    rec.down(1, 50, 50, 0, ALL);
    rec.move(1, 90, 50);
    fire();
    rec.up(1, 90, 50, 900);
    expect(got).toEqual([]);
  });

  it('presses are off where not allowed (e.g. on a button)', () => {
    const { rec, got, fire, tap } = setup();
    const noPress: Allow = { ...ALL, press: false };
    rec.down(1, 50, 50, 0, noPress);
    fire();
    rec.up(1, 50, 50, 700);
    tap(50, 50, 1000, noPress);
    tap(50, 50, 1100, noPress);
    expect(got).toEqual([]);
  });
});

describe('pinch', () => {
  const pinch = (rec: ReturnType<typeof setup>['rec'], from: number, to: number, allow = ALL) => {
    rec.down(1, 200 - from / 2, 400, 0, allow);
    rec.down(2, 200 + from / 2, 400, 10, allow);
    for (let i = 1; i <= 4; i++) {
      const d = from + ((to - from) * i) / 4;
      rec.move(1, 200 - d / 2, 400);
      rec.move(2, 200 + d / 2, 400);
    }
    rec.up(1, 200 - to / 2, 400, 300);
    rec.up(2, 200 + to / 2, 400, 310);
  };

  it('recognises pinch out and pinch in', () => {
    const { rec, got } = setup();
    pinch(rec, 100, 200);
    pinch(rec, 200, 90);
    expect(got).toEqual(['pinch-out', 'pinch-in']);
  });

  it('ignores a small change in finger distance', () => {
    const { rec, got } = setup();
    pinch(rec, 100, 115);
    expect(got).toEqual([]);
  });

  it('a pinch is not also a swipe or long press', () => {
    const { rec, got, fire } = setup();
    rec.down(1, 150, 400, 0, ALL);
    rec.down(2, 250, 400, 10, ALL);
    fire();
    rec.move(1, 50, 400);
    rec.move(2, 350, 400);
    rec.up(1, 50, 400, 200);
    rec.up(2, 350, 400, 210);
    expect(got).toEqual(['pinch-out']);
  });

  it('three fingers cancel everything', () => {
    const { rec, got } = setup();
    rec.down(1, 100, 400, 0, ALL);
    rec.down(2, 200, 400, 0, ALL);
    rec.down(3, 300, 400, 0, ALL);
    rec.move(1, 0, 400);
    rec.move(2, 300, 400);
    rec.up(1, 0, 400, 200);
    rec.up(2, 300, 400, 200);
    rec.up(3, 300, 400, 200);
    expect(got).toEqual([]);
  });

  it('pinch is off where not allowed', () => {
    const { rec, got } = setup();
    pinch(rec, 100, 220, { ...ALL, pinch: false });
    expect(got).toEqual([]);
  });

  it('a cancelled pointer (browser took over scrolling) reports nothing', () => {
    const { rec, got } = setup();
    rec.down(1, 200, 500, 0, ALL);
    rec.move(1, 200, 300);
    rec.cancel(1);
    rec.up(1, 200, 300, 200);
    expect(got).toEqual([]);
  });
});

describe('gesture settings', () => {
  beforeEach(() => undefined);

  it('defaults follow the Phase 6 spec', () => {
    expect(DEFAULT_MAP).toEqual({
      'swipe-up': 'open-hell',
      'swipe-down': 'minimize',
      'swipe-left': 'prev-module',
      'swipe-right': 'next-module',
      'double-tap': 'listen',
      'long-press': 'open-settings',
      'pinch-out': 'expand-holo',
      'pinch-in': 'collapse-holo',
    });
  });

  it('sanitizes junk from storage', () => {
    const s = sanitizeSettings({ enabled: 'yes', tuning: { swipeDistance: 5, longPressMs: 'x' }, map: { 'swipe-up': 'rm -rf', 'swipe-left': 'next-module' } });
    expect(s.enabled).toBe(true);
    expect(s.tuning.swipeDistance).toBe(40);
    expect(s.tuning.longPressMs).toBe(DEFAULT_RECOGNIZER.longPressMs);
    expect(s.map['swipe-up']).toBe('open-hell');
    expect(s.map['swipe-left']).toBe('next-module');
    expect(sanitizeSettings(null).enabled).toBe(true);
  });
});

describe('module order for swipes', () => {
  it('starts at HELL and lists only working modules', () => {
    const list = carousel();
    expect(list[0]).toMatchObject({ id: 'home', route: '/m' });
    expect(list.map((e) => e.id)).not.toContain('apps');
    expect(list.map((e) => e.id)).toContain('calibration');
    expect(list.map((e) => e.id)).toContain('gestures');
  });

  it('tells Tasks and Notes apart (same page, different view)', () => {
    const list = carousel();
    const tasks = list.findIndex((e) => e.id === 'tasks');
    const notes = list.findIndex((e) => e.id === 'notes');
    expect(carouselIndex('/m/tasks', '', list)).toBe(tasks);
    expect(carouselIndex('/m/tasks', '?view=notes', list)).toBe(notes);
    expect(carouselIndex('/m/tasks/', '?view=tasks', list)).toBe(tasks);
  });

  it('steps both ways and wraps around', () => {
    const list = carousel();
    expect(stepCarousel('/m', '', 1, list)?.id).toBe(list[1].id);
    expect(stepCarousel('/m', '', -1, list)?.id).toBe(list[list.length - 1].id);
    expect(stepCarousel(list[list.length - 1].route.split('?')[0], list[list.length - 1].route.split('?')[1] ?? '', 1, list)?.id).toBe('home');
  });

  it('does nothing on screens outside the order (e.g. Chat)', () => {
    expect(carouselIndex('/m/chat', '')).toBe(-1);
    expect(stepCarousel('/m/chat', '', 1)).toBeNull();
  });
});

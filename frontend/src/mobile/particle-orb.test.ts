import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLinks, buildShell, targetsFor } from './particle-orb-engine';
import { DEFAULT_ORB_PREFS, particleCount, REDUCED_PARTICLES, sanitizeOrbPrefs } from './orb-prefs';
import { createPressRecognizer } from './press-recognizer';
import { ORB_CAPTIONS, type OrbState } from './orb-types';

const ALL: OrbState[] = ['idle', 'listening', 'thinking', 'speaking', 'vision', 'error', 'activating', 'offline'];

describe('orb state targets', () => {
  it('every state has a caption and targets', () => {
    for (const s of ALL) {
      expect(ORB_CAPTIONS[s]).toBeTruthy();
      expect(targetsFor(s).energy).toBeGreaterThan(0);
    }
  });

  it('maps each state to its signature motion', () => {
    const idle = targetsFor('idle');
    expect(targetsFor('listening').expand).toBe(1); // expand and brighten
    expect(targetsFor('listening').energy).toBeGreaterThan(idle.energy);
    expect(targetsFor('thinking').spiral).toBe(1); // spiral inward…
    expect(targetsFor('thinking').speed).toBeGreaterThan(idle.speed * 3); // …and accelerate
    expect(targetsFor('speaking').pulse).toBe(1);
    expect(targetsFor('vision').scan).toBe(1);
    expect(targetsFor('error').error).toBe(1);
    expect(targetsFor('offline').dim).toBe(1);
    expect(idle).toMatchObject({ expand: 0, spiral: 0, pulse: 0, scan: 0, error: 0, dim: 0 });
  });
});

describe('particle geometry', () => {
  it('places the requested number of unit-length directions, deterministically', () => {
    const a = buildShell(3000);
    expect(a.dir.length).toBe(9000);
    expect(a.rand.length).toBe(12000);
    for (let i = 0; i < 3000; i += 97) {
      const len = Math.hypot(a.dir[i * 3], a.dir[i * 3 + 1], a.dir[i * 3 + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
    expect(Array.from(buildShell(3000).dir.slice(0, 30))).toEqual(Array.from(a.dir.slice(0, 30)));
  });

  it('covers the whole sphere (hollow shell, not clumped)', () => {
    const { dir } = buildShell(4000);
    const octants = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      octants.add((dir[i * 3] > 0 ? 1 : 0) | (dir[i * 3 + 1] > 0 ? 2 : 0) | (dir[i * 3 + 2] > 0 ? 4 : 0));
    }
    expect(octants.size).toBe(8);
  });

  it('links only nearby particles and puts both ends in the same band', () => {
    const shell = buildShell(5000);
    const pairs = buildLinks(shell, 800, 0.16);
    expect(pairs.length).toBeGreaterThan(400);
    expect(pairs.length).toBeLessThanOrEqual(800);
    for (const [i, j] of pairs.slice(0, 200)) {
      const d = Math.hypot(
        shell.dir[i * 3] - shell.dir[j * 3],
        shell.dir[i * 3 + 1] - shell.dir[j * 3 + 1],
        shell.dir[i * 3 + 2] - shell.dir[j * 3 + 2],
      );
      expect(d).toBeLessThan(0.16);
      expect(shell.rand[i * 4 + 3]).toBe(shell.rand[j * 4 + 3]);
    }
  });
});

describe('orb preferences', () => {
  it('rejects garbage and clamps ranges', () => {
    expect(sanitizeOrbPrefs(null)).toEqual(DEFAULT_ORB_PREFS);
    expect(sanitizeOrbPrefs({ palette: 'nope', density: 'ultra', scale: 9, speed: -1, glow: 'x', reducedEffects: 'yes' })).toEqual({
      ...DEFAULT_ORB_PREFS,
      scale: 1.3,
      speed: 0.5,
    });
    expect(sanitizeOrbPrefs({ palette: 'violet', density: 'high' })).toMatchObject({ palette: 'violet', density: 'high' });
  });

  it('reduced effects caps the particle count', () => {
    expect(particleCount({ density: 'high', reducedEffects: false })).toBe(9000);
    expect(particleCount({ density: 'high', reducedEffects: true })).toBe(REDUCED_PARTICLES);
  });
});

describe('press recognizer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const calls: string[] = [];
    const r = createPressRecognizer(() => ({
      onTap: () => calls.push('tap'),
      onDoubleTap: () => calls.push('double'),
      onLongPress: () => calls.push('long'),
    }));
    return { r, calls };
  };

  it('single tap fires after the double-tap window', () => {
    const { r, calls } = setup();
    r.down(0, 0);
    r.up();
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(calls).toEqual(['tap']);
  });

  it('double tap fires once and suppresses the tap', () => {
    const { r, calls } = setup();
    r.down(0, 0);
    r.up();
    vi.advanceTimersByTime(120);
    r.down(2, 2);
    r.up();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['double']);
  });

  it('long press fires while held and nothing on release', () => {
    const { r, calls } = setup();
    r.down(0, 0);
    vi.advanceTimersByTime(600);
    expect(calls).toEqual(['long']);
    r.up();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['long']);
  });

  it('moving the finger cancels (it was a swipe)', () => {
    const { r, calls } = setup();
    r.down(0, 0);
    r.move(40, 0);
    r.up();
    vi.advanceTimersByTime(800);
    expect(calls).toEqual([]);
  });

  it('without a double-tap handler, taps fire immediately', () => {
    const calls: string[] = [];
    const r = createPressRecognizer(() => ({ onTap: () => calls.push('tap') }));
    r.down(0, 0);
    r.up();
    expect(calls).toEqual(['tap']);
  });
});

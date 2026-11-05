import { describe, expect, it } from 'vitest';
import { deriveOrbState, type OrbInputs } from './orb-state';
import { drawOrb, ORB_CAPTIONS } from './CanvasOrb';

const base: OrbInputs = { online: true, speech: 'idle', isStreaming: false, streamContent: '', tts: 'idle' };

describe('deriveOrbState', () => {
  it('is idle when nothing is happening', () => {
    expect(deriveOrbState(base)).toBe('idle');
    expect(deriveOrbState({ ...base, online: null })).toBe('idle');
  });

  it('shows offline when the backend is unreachable, over everything else', () => {
    expect(deriveOrbState({ ...base, online: false, speech: 'recording' })).toBe('offline');
  });

  it('listening wins while the user is talking, even over speech output', () => {
    expect(deriveOrbState({ ...base, speech: 'recording', tts: 'speaking', isStreaming: true })).toBe('listening');
  });

  it('thinks while transcribing, synthesizing, or waiting for the first token', () => {
    expect(deriveOrbState({ ...base, speech: 'transcribing' })).toBe('thinking');
    expect(deriveOrbState({ ...base, tts: 'loading' })).toBe('thinking');
    expect(deriveOrbState({ ...base, isStreaming: true })).toBe('thinking');
  });

  it('speaks while text streams in or audio plays', () => {
    expect(deriveOrbState({ ...base, isStreaming: true, streamContent: 'Hello' })).toBe('speaking');
    expect(deriveOrbState({ ...base, tts: 'speaking' })).toBe('speaking');
  });
});

describe('drawOrb', () => {
  it('draws every state without throwing on a 2D context', () => {
    // Record calls on a permissive stand-in; jsdom-free environment has no canvas.
    const calls: string[] = [];
    const gradient = { addColorStop: () => {} };
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, prop: string) => {
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
        return (..._args: unknown[]) => {
          calls.push(prop);
        };
      },
      set: () => true,
    });
    const profiles = {
      idle: { energy: 0.35, spin: 0.25, hue: [0, 160, 255] as [number, number, number], wave: 0 },
      loud: { energy: 1, spin: 2, hue: [92, 225, 255] as [number, number, number], wave: 1 },
    };
    for (const p of Object.values(profiles)) drawOrb(ctx, 200, 1.5, p, []);
    expect(calls).toContain('arc');
    expect(calls).toContain('clearRect');
  });

  it('has a caption for every state', () => {
    for (const s of ['idle', 'listening', 'thinking', 'speaking', 'offline'] as const) {
      expect(ORB_CAPTIONS[s]).toBeTruthy();
    }
  });
});

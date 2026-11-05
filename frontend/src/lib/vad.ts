/**
 * Voice activity detection for hands-free turns: decide when you started
 * talking and when you stopped, from a stream of 0..1 mic levels. Pure.
 *
 *  - The threshold adapts to the room: the first `calibrateMs` measure the
 *    background (capped, so talking straight away still works), then the
 *    noise floor falls fast on quiet, follows steady noise, and rises only
 *    very slowly during speech.
 *  - "done" needs real speech first (>= minSpeechMs), then `silenceMs` quiet.
 *  - "no-speech" if nothing is said for `noSpeechMs` (ends a follow-up turn).
 *  - "max" caps one turn.
 */
export interface VadOptions {
  threshold: number;
  calibrateMs: number;
  silenceMs: number;
  noSpeechMs: number;
  minSpeechMs: number;
  maxMs: number;
}

export const DEFAULT_VAD: VadOptions = { threshold: 0.08, calibrateMs: 300, silenceMs: 1300, noSpeechMs: 7000, minSpeechMs: 250, maxMs: 45000 };

export type VadState = 'waiting' | 'speech' | 'done' | 'no-speech' | 'max';

export function createVad(opts: VadOptions = DEFAULT_VAD) {
  let start: number | null = null;
  let floor = 0.02;
  let speechMs = 0;
  let lastLoud: number | null = null;
  let lastT: number | null = null;
  let finished: VadState | null = null;

  return {
    feed(level: number, t: number): VadState {
      if (finished) return finished;
      if (start === null) start = t;
      const dt = lastT === null ? 0 : Math.max(0, Math.min(250, t - lastT));
      lastT = t;
      if (t - start < opts.calibrateMs) {
        floor = Math.min(0.12, Math.max(floor, level));
        return 'waiting';
      }
      const threshold = Math.max(opts.threshold, floor * 2.5);
      const loud = level >= threshold;
      const rate = level < floor ? 300 : loud ? 8000 : 1500;
      floor += (level - floor) * Math.min(1, dt / rate);
      if (loud) {
        speechMs += dt;
        lastLoud = t;
      }
      const spoke = speechMs >= opts.minSpeechMs;
      if (t - start >= opts.maxMs) return (finished = 'max');
      if (spoke && lastLoud !== null && t - lastLoud >= opts.silenceMs) return (finished = 'done');
      if (!spoke && t - start >= opts.noSpeechMs) return (finished = 'no-speech');
      return spoke || loud ? 'speech' : 'waiting';
    },
  };
}

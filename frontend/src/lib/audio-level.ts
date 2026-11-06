/**
 * Audio levels for the voice-reactive orb and silence detection.
 *
 * HELL's own voice: the volume envelope is read straight from the WAV the
 * server returns (no Web Audio routing of playback, which on iOS can mute
 * audio if the context gets suspended), then looked up by playback time.
 *
 * Your voice: an analyser on the microphone stream (input only).
 */

/** RMS per `frameMs` window, 0..1, from a PCM16 or float32 WAV. null if unreadable. */
export function wavEnvelope(buf: ArrayBuffer, frameMs = 40): { frames: Float32Array; frameMs: number } | null {
  const v = new DataView(buf);
  if (buf.byteLength < 44 || v.getUint32(0, false) !== 0x52494646 /* RIFF */ || v.getUint32(8, false) !== 0x57415645 /* WAVE */) return null;
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= buf.byteLength) {
    const id = v.getUint32(pos, false);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 0x666d7420 /* 'fmt ' */) {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 0x64617461 /* 'data' */ && fmt) {
      const { format, channels, rate, bits } = fmt;
      const pcm16 = format === 1 && bits === 16;
      const f32 = format === 3 && bits === 32;
      if ((!pcm16 && !f32) || !channels || !rate) return null;
      const bytesPer = bits / 8;
      const end = Math.min(buf.byteLength, body + size);
      const total = Math.floor((end - body) / (bytesPer * channels));
      const per = Math.max(1, Math.round((rate * frameMs) / 1000));
      const frames = new Float32Array(Math.ceil(total / per));
      for (let f = 0; f < frames.length; f++) {
        let sum = 0;
        let n = 0;
        for (let i = f * per; i < Math.min(total, (f + 1) * per); i++) {
          const o = body + i * bytesPer * channels; // first channel is enough
          const s = pcm16 ? v.getInt16(o, true) / 32768 : v.getFloat32(o, true);
          sum += s * s;
          n++;
        }
        frames[f] = n ? Math.min(1, Math.sqrt(sum / n) * 3.2) : 0;
      }
      return { frames, frameMs };
    }
    pos = body + size + (size % 2);
  }
  return null;
}

export function levelAt(env: { frames: Float32Array; frameMs: number } | null, seconds: number): number | null {
  if (!env || !Number.isFinite(seconds)) return null;
  const i = Math.floor((seconds * 1000) / env.frameMs);
  return i >= 0 && i < env.frames.length ? env.frames[i] : 0;
}

// ---- One shared AudioContext, resumed by the first tap (iOS rule) -------

type Ctx = AudioContext;
let ctx: Ctx | null = null;

export function audioContext(): Ctx | null {
  if (ctx) return ctx;
  const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a user gesture so later (non-gesture) analysis works on iOS. */
export function resumeAudioContext(): void {
  const c = audioContext();
  if (c && c.state !== 'running') void c.resume().catch(() => undefined);
}

/** Live 0..1 level of a microphone stream; `level()` is null when unavailable. */
export function meterStream(stream: MediaStream): { level: () => number | null; close: () => void } {
  const c = audioContext();
  if (!c) return { level: () => null, close: () => undefined };
  try {
    const src = c.createMediaStreamSource(stream);
    const an = c.createAnalyser();
    an.fftSize = 1024;
    src.connect(an); // input only: never connected to the speakers
    const buf = new Float32Array(an.fftSize);
    return {
      level: () => {
        if (c.state !== 'running') return null;
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        return Math.min(1, Math.sqrt(sum / buf.length) * 4);
      },
      close: () => {
        try {
          src.disconnect();
          an.disconnect();
        } catch {
          // already gone
        }
      },
    };
  } catch {
    return { level: () => null, close: () => undefined };
  }
}

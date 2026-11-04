import { useEffect, useRef } from 'react';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'offline';

/** Visual parameters per state; the animation eases between them. */
interface Profile {
  energy: number; // overall motion + glow, 0..1
  spin: number; // ring rotation speed, rad/s
  hue: [number, number, number]; // core RGB
  wave: number; // outer waveform amplitude, 0..1
}

const PROFILES: Record<OrbState, Profile> = {
  idle: { energy: 0.35, spin: 0.25, hue: [0, 160, 255], wave: 0.05 },
  listening: { energy: 0.8, spin: 0.6, hue: [92, 225, 255], wave: 0.9 },
  thinking: { energy: 0.65, spin: 2.2, hue: [96, 132, 255], wave: 0.15 },
  speaking: { energy: 1, spin: 0.9, hue: [0, 200, 255], wave: 0.55 },
  offline: { energy: 0.12, spin: 0.08, hue: [70, 90, 130], wave: 0 },
};

export const ORB_CAPTIONS: Record<OrbState, string> = {
  idle: 'Tap to talk',
  listening: 'Listening… tap to send',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  offline: 'Offline',
};

interface Particle {
  r: number; // orbit radius factor
  a: number; // angle
  s: number; // speed factor
  tilt: number;
  size: number;
}

function makeParticles(n: number): Particle[] {
  const out: Particle[] = [];
  // Deterministic spread (golden angle) so renders are stable across mounts.
  for (let i = 0; i < n; i++) {
    out.push({
      r: 0.62 + ((i * 37) % 100) / 100 * 0.38,
      a: i * 2.39996,
      s: 0.4 + ((i * 53) % 100) / 100 * 0.9,
      tilt: 0.25 + ((i * 29) % 100) / 100 * 0.6,
      size: 0.6 + ((i * 17) % 100) / 100 * 1.4,
    });
  }
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Draw one frame. Exported for tests and the reduced-motion still frame. */
export function drawOrb(
  ctx: CanvasRenderingContext2D,
  size: number,
  t: number,
  p: Profile,
  particles: Particle[],
): void {
  const c = size / 2;
  const R = size * 0.3; // core radius
  const [hr, hg, hb] = p.hue;
  const rgba = (a: number) => `rgba(${hr | 0}, ${hg | 0}, ${hb | 0}, ${a})`;

  ctx.clearRect(0, 0, size, size);

  // Speech-like envelope: layered sines read as natural cadence.
  const env =
    0.5 + 0.5 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1) * (0.6 + 0.4 * Math.sin(t * 13.7));
  const breathe = 1 + 0.035 * Math.sin(t * 1.6) * (0.5 + p.energy) + p.wave * 0.06 * env;

  // Outer halo.
  const halo = ctx.createRadialGradient(c, c, R * 0.6, c, c, size * 0.5);
  halo.addColorStop(0, rgba(0.28 * (0.4 + p.energy)));
  halo.addColorStop(0.55, rgba(0.08 * (0.4 + p.energy)));
  halo.addColorStop(1, rgba(0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // HUD ring with tick marks, slowly counter-rotating.
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-t * p.spin * 0.25);
  const ringR = size * 0.44;
  ctx.strokeStyle = rgba(0.22);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, ringR, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    const inner = ringR - (long ? 7 : 3);
    ctx.strokeStyle = rgba(long ? 0.55 : 0.22);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * ringR, Math.sin(a) * ringR);
    ctx.stroke();
  }
  // Bright scanning arcs.
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(0.75);
  ctx.shadowColor = rgba(0.9);
  ctx.shadowBlur = 8;
  for (let k = 0; k < 3; k++) {
    const start = t * p.spin * (k % 2 ? -1 : 1) * 0.8 + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(0, 0, ringR + 6, start, start + 0.5 + 0.3 * p.energy);
    ctx.stroke();
  }
  ctx.restore();

  // Waveform ring (listening/speaking).
  if (p.wave > 0.01) {
    ctx.save();
    ctx.translate(c, c);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(0.65);
    ctx.shadowColor = rgba(0.8);
    ctx.shadowBlur = 10;
    ctx.beginPath();
    const base = R * 1.32;
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const n =
        Math.sin(a * 6 + t * 5) * 0.5 + Math.sin(a * 11 - t * 7.5) * 0.3 + Math.sin(a * 3 + t * 2.3) * 0.2;
      const r = base + n * R * 0.16 * p.wave * (0.5 + env);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // Holographic gyroscope: tilted elliptical rings around the core.
  ctx.save();
  ctx.translate(c, c);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const rot = t * p.spin * (0.6 + i * 0.22) * (i % 2 ? -1 : 1) + i * 0.7;
    const squash = 0.28 + 0.14 * Math.sin(t * 0.7 + i);
    ctx.save();
    ctx.rotate(rot);
    ctx.scale(1, squash);
    ctx.strokeStyle = rgba(0.18 + 0.2 * p.energy);
    ctx.beginPath();
    ctx.arc(0, 0, R * (1.12 + i * 0.05) * breathe, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Core sphere.
  const coreR = R * breathe;
  const core = ctx.createRadialGradient(c - coreR * 0.3, c - coreR * 0.35, coreR * 0.05, c, c, coreR);
  core.addColorStop(0, 'rgba(235, 250, 255, 0.95)');
  core.addColorStop(0.18, rgba(0.95));
  core.addColorStop(0.6, `rgba(${(hr * 0.35) | 0}, ${(hg * 0.4) | 0}, ${(hb * 0.75) | 0}, 0.85)`);
  core.addColorStop(1, 'rgba(4, 12, 40, 0.15)');
  ctx.save();
  ctx.shadowColor = rgba(0.9);
  ctx.shadowBlur = 30 + 30 * p.energy;
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(c, c, coreR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Inner plasma swirl, clipped to the core.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, coreR, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const a = t * (0.5 + p.spin * 0.4) * (i % 2 ? 1 : -1) + i * 1.6;
    const ox = Math.cos(a) * coreR * 0.35;
    const oy = Math.sin(a * 1.3) * coreR * 0.35;
    const g = ctx.createRadialGradient(c + ox, c + oy, 0, c + ox, c + oy, coreR * 0.75);
    g.addColorStop(0, rgba(0.22 + 0.2 * p.energy));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g;
    ctx.fillRect(c - coreR, c - coreR, coreR * 2, coreR * 2);
  }
  // Scan line sweeping down the sphere.
  const scanY = c - coreR + ((t * 0.45) % 1) * coreR * 2;
  const scan = ctx.createLinearGradient(0, scanY - 6, 0, scanY + 6);
  scan.addColorStop(0, 'rgba(255,255,255,0)');
  scan.addColorStop(0.5, `rgba(200, 245, 255, ${0.25 * (0.4 + p.energy)})`);
  scan.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = scan;
  ctx.fillRect(c - coreR, scanY - 6, coreR * 2, 12);
  ctx.restore();

  // Orbiting particles.
  ctx.save();
  ctx.translate(c, c);
  for (const pt of particles) {
    const a = pt.a + t * pt.s * (0.3 + p.spin * 0.5);
    const r = size * 0.5 * pt.r * (0.92 + 0.05 * p.energy);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * pt.tilt;
    const front = Math.sin(a) > 0;
    ctx.fillStyle = rgba((front ? 0.85 : 0.35) * (0.4 + p.energy * 0.6));
    ctx.beginPath();
    ctx.arc(x, y, pt.size * (front ? 1.2 : 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface JarvisOrbProps {
  state: OrbState;
  size?: number;
  onPress?: () => void;
  disabled?: boolean;
  /** Accessible name; defaults to the state's caption. */
  label?: string;
  showCaption?: boolean;
  /** Overrides the default caption for the current state. */
  caption?: string;
}

export function JarvisOrb({ state, size = 240, onPress, disabled, label, showCaption = true, caption: captionOverride }: JarvisOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const particles = makeParticles(size > 160 ? 46 : 22);
    const cur: Profile = { ...PROFILES[stateRef.current], hue: [...PROFILES[stateRef.current].hue] };

    if (prefersReducedMotion()) {
      // One still frame per state change, no animation loop.
      drawOrb(ctx, size, 1.2, PROFILES[stateRef.current], particles);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let t = 0;
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const target = PROFILES[stateRef.current];
      const k = 1 - Math.exp(-dt * 4); // ~250ms easing between states
      cur.energy = lerp(cur.energy, target.energy, k);
      cur.spin = lerp(cur.spin, target.spin, k);
      cur.wave = lerp(cur.wave, target.wave, k);
      cur.hue = [0, 1, 2].map((i) => lerp(cur.hue[i], target.hue[i], k)) as Profile['hue'];
      t += dt * (0.7 + cur.energy * 0.6);
      drawOrb(ctx, size, t, cur, particles);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // Reduced motion redraws on state change; animated mode reads stateRef.
  }, [size, prefersReducedMotion() ? state : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const caption = captionOverride ?? ORB_CAPTIONS[state];
  const interactive = Boolean(onPress);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {interactive ? (
        <button
          type="button"
          className="jm-orb"
          style={{ width: size, height: size }}
          onClick={onPress}
          disabled={disabled}
          aria-label={label ?? caption}
          aria-pressed={state === 'listening'}
        >
          <canvas ref={canvasRef} aria-hidden="true" />
        </button>
      ) : (
        <div className="jm-orb" style={{ width: size, height: size, cursor: 'default' }} role="img" aria-label={label ?? `Jarvis: ${caption}`}>
          <canvas ref={canvasRef} aria-hidden="true" />
        </div>
      )}
      {showCaption && (
        <div className="jm-orb-caption" aria-live="polite">
          {caption}
        </div>
      )}
    </div>
  );
}

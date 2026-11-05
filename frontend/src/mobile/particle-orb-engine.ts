/**
 * HELL particle orb, rendered with three.js.
 *
 * Everything that moves is computed in vertex shaders from per-particle
 * attributes and a handful of uniforms, so the CPU work per frame is a few
 * uniform updates regardless of particle count. That keeps it smooth and
 * battery-friendly on iPhone.
 *
 *   shell    thousands of points on a hollow sphere (transparent centre)
 *   links    flickering lines between neighbouring shell points
 *   streams  energy ribbons flowing around the orb, each with a fading trail
 *   rings    dashed orbital rings
 *   base     optional projector glow beneath the orb
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineLoop,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three';
import type { OrbState } from './orb-types';
import { ORB_PALETTES, particleCount, type OrbPrefs } from './orb-prefs';

// ---------------------------------------------------------------------------
// State → animation targets (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface OrbTargets {
  /** Overall brightness and motion. */
  energy: number;
  /** Shell grows outward (listening). */
  expand: number;
  /** Particles accelerate and spiral inward (thinking). */
  spiral: number;
  /** Rotation speed. */
  speed: number;
  /** Pulse with audio level (speaking). */
  pulse: number;
  /** Scanning band sweeps the orb (vision). */
  scan: number;
  /** Mix toward red (error). */
  error: number;
  /** Desaturate and dim (offline). */
  dim: number;
}

const BASE: OrbTargets = { energy: 0.45, expand: 0, spiral: 0, speed: 0.35, pulse: 0, scan: 0, error: 0, dim: 0 };

export function targetsFor(state: OrbState): OrbTargets {
  switch (state) {
    case 'listening':
      return { ...BASE, energy: 1, expand: 1, speed: 0.55 };
    case 'thinking':
      return { ...BASE, energy: 0.8, spiral: 1, speed: 2.2 };
    case 'speaking':
      return { ...BASE, energy: 0.9, pulse: 1, speed: 0.7 };
    case 'vision':
      return { ...BASE, energy: 0.8, scan: 1, speed: 0.5 };
    case 'error':
      return { ...BASE, energy: 0.85, error: 1, speed: 0.6 };
    case 'activating':
      return { ...BASE, energy: 1, speed: 1.2 };
    case 'offline':
      return { ...BASE, energy: 0.2, speed: 0.1, dim: 1 };
    case 'idle':
    default:
      return { ...BASE };
  }
}

// ---------------------------------------------------------------------------
// Geometry builders (pure, unit-tested)
// ---------------------------------------------------------------------------

/** Deterministic PRNG so the orb looks the same on every mount. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ShellData {
  dir: Float32Array; // unit vectors, 3 per particle
  rand: Float32Array; // 4 per particle: radius jitter, phase, heat, band
}

/** Fibonacci-sphere directions with jitter: even coverage, no clumps. */
export function buildShell(count: number, seed = 7): ShellData {
  const rnd = mulberry32(seed);
  const dir = new Float32Array(count * 3);
  const rand = new Float32Array(count * 4);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i + (rnd() - 0.5) * 0.6;
    let x = Math.cos(th) * r;
    let z = Math.sin(th) * r;
    let yy = y + (rnd() - 0.5) * 0.02;
    const len = Math.hypot(x, yy, z) || 1;
    x /= len;
    yy /= len;
    z /= len;
    dir.set([x, yy, z], i * 3);
    rand.set([rnd(), rnd() * Math.PI * 2, Math.pow(rnd(), 2.2), rnd()], i * 4);
  }
  return { dir, rand };
}

/**
 * Pairs of nearby shell particles to connect with lines. Linked particles are
 * given the same circulation band so the lines stay short as they move.
 */
export function buildLinks(shell: ShellData, maxLinks: number, maxDist = 0.16): Array<[number, number]> {
  const n = shell.dir.length / 3;
  const step = Math.max(1, Math.floor(n / Math.min(n, maxLinks)));
  const idx: number[] = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  const pairs: Array<[number, number]> = [];
  const d2max = maxDist * maxDist;
  for (let a = 0; a < idx.length && pairs.length < maxLinks; a++) {
    const i = idx[a];
    let best = -1;
    let bestD = d2max;
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b];
      const dx = shell.dir[i * 3] - shell.dir[j * 3];
      const dy = shell.dir[i * 3 + 1] - shell.dir[j * 3 + 1];
      const dz = shell.dir[i * 3 + 2] - shell.dir[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD) {
        bestD = d2;
        best = j;
      }
    }
    if (best >= 0) pairs.push([i, best]);
  }
  for (const [i, j] of pairs) {
    shell.rand[i * 4 + 3] = 0.15;
    shell.rand[j * 4 + 3] = 0.15;
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uExpand;
  uniform float uSpiral;
  uniform float uPulse;
  uniform float uLevel;
  uniform float uScatter;
  uniform float uRadius;

  vec3 rotateAxis(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }

  // Shell particle position: circulation, flowing wave, listening expansion,
  // thinking spiral, speaking pulse, holographic wobble, activation scatter.
  vec3 shellPos(vec3 dir, vec4 r) {
    float t = uTime;
    float ang = t * (0.18 + 0.42 * r.w) * (1.0 + 2.6 * uSpiral);
    vec3 d = rotateAxis(dir, normalize(vec3(0.22, 1.0, 0.12)), ang);
    float wave = sin(d.y * 6.0 + t * 1.4 + r.y) * 0.035;
    float rad = uRadius * (0.84 + 0.16 * r.x + wave);
    rad *= 1.0 + 0.24 * uExpand;
    rad *= 1.0 - 0.38 * uSpiral * (0.5 + 0.5 * sin(t * 2.2 + r.y));
    rad *= 1.0 + 0.16 * uPulse * uLevel * (0.6 + 0.4 * sin(r.y * 3.0 + t * 9.0));
    vec3 p = d * rad;
    p += 0.014 * uRadius * vec3(sin(t * 1.7 + p.y * 9.0), sin(t * 1.3 + p.z * 9.0), sin(t * 1.9 + p.x * 9.0));
    p += d * uScatter * uRadius * (1.0 + 2.4 * r.x);
    return p;
  }

  float depthOf(vec3 p) { return clamp(p.z / (uRadius * 1.4) * 0.5 + 0.5, 0.0, 1.0); }
`;

const COLOR = /* glsl */ `
  uniform vec3 uCore;
  uniform vec3 uAccent;
  uniform vec3 uHot;
  uniform float uError;
  uniform float uDim;
  uniform float uGlow;

  vec3 orbColor(float heat) {
    vec3 c = mix(uCore, uAccent, heat);
    c = mix(c, uHot, smoothstep(0.82, 1.0, heat) * 0.85);
    c = mix(c, vec3(1.0, 0.16, 0.24), uError);
    c = mix(c, vec3(dot(c, vec3(0.33))) * vec3(0.5, 0.6, 0.85), uDim);
    return c * uGlow;
  }
`;

const SHELL_VERT = /* glsl */ `
  ${COMMON}
  attribute vec3 aDir;
  attribute vec4 aRand;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uScan;
  uniform float uEnergy;
  varying float vAlpha;
  varying float vHeat;
  varying float vScan;
  void main() {
    vec3 p = shellPos(aDir, aRand);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = depthOf((modelMatrix * vec4(p, 1.0)).xyz);
    float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + aRand.z * 4.0) + aRand.y * 7.0);
    vAlpha = mix(0.14, 0.85, depth) * (0.4 + 0.6 * aRand.z) * twinkle * (0.5 + 0.55 * uEnergy);
    vHeat = aRand.z;
    float band = mod(uTime * 0.55, 2.4) - 1.2;
    vScan = uScan * smoothstep(0.1, 0.0, abs(p.y / uRadius - band));
    gl_PointSize = uSize * uPixelRatio * (0.55 + 0.9 * aRand.z) * (0.65 + 0.7 * depth) * (1.0 + 0.35 * uExpand);
  }
`;

const POINT_FRAG = /* glsl */ `
  ${COLOR}
  uniform float uOpacity;
  varying float vAlpha;
  varying float vHeat;
  varying float vScan;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float a = exp(-d2 * 16.0);
    vec3 col = orbColor(vHeat) + vScan * vec3(0.35, 1.0, 0.85);
    gl_FragColor = vec4(col, a * vAlpha * uOpacity);
  }
`;

const LINK_VERT = /* glsl */ `
  ${COMMON}
  attribute vec3 aDir;
  attribute vec4 aRand;
  attribute float aPair;
  uniform float uEnergy;
  varying float vAlpha;
  void main() {
    vec3 p = shellPos(aDir, aRand);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float depth = depthOf((modelMatrix * vec4(p, 1.0)).xyz);
    float flicker = 0.5 + 0.5 * sin(uTime * 2.3 + aPair * 37.0);
    vAlpha = 0.22 * flicker * mix(0.15, 1.0, depth) * (0.5 + 0.7 * uEnergy) * (1.0 - uScatter);
  }
`;

const LINK_FRAG = /* glsl */ `
  ${COLOR}
  uniform float uOpacity;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(orbColor(0.6), vAlpha * uOpacity); }
`;

const STREAM_VERT = /* glsl */ `
  ${COMMON}
  attribute vec3 aU;
  attribute vec3 aV;
  attribute vec4 aS; // angle, ribbon offset, speed, trail index
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uEnergy;
  varying float vAlpha;
  varying float vHeat;
  varying float vScan;
  void main() {
    float th = aS.x + uTime * aS.z * (1.0 + 2.2 * uSpiral) - aS.w * 0.045;
    vec3 n = normalize(cross(aU, aV));
    float rad = uRadius * (0.98 + 0.06 * sin(th * 3.0 + aS.y * 9.0));
    rad *= (1.0 + 0.2 * uExpand) * (1.0 - 0.3 * uSpiral);
    rad *= 1.0 + 0.12 * uPulse * uLevel;
    vec3 p = rad * (cos(th) * aU + sin(th) * aV) + n * aS.y * uRadius * 0.16 * sin(th * 2.0 + uTime);
    p += normalize(p) * uScatter * uRadius * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    float depth = depthOf((modelMatrix * vec4(p, 1.0)).xyz);
    float trail = 1.0 - aS.w / 6.0;
    vAlpha = trail * trail * mix(0.25, 0.9, depth) * (0.55 + 0.6 * uEnergy) * (1.0 - 0.7 * uScatter);
    vHeat = 0.35 + 0.4 * trail;
    vScan = 0.0;
    gl_PointSize = uSize * uPixelRatio * (0.7 + 1.1 * trail) * (0.7 + 0.6 * depth);
  }
`;

const RING_VERT = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const RING_FRAG = /* glsl */ `
  ${COLOR}
  uniform float uTime;
  uniform float uDash;
  uniform float uSpin;
  uniform float uOpacity;
  uniform float uEnergy;
  varying float vT;
  void main() {
    float dash = step(fract(vT * uDash - uTime * uSpin), 0.55);
    float a = (0.12 + 0.5 * dash) * (0.5 + 0.6 * uEnergy);
    gl_FragColor = vec4(orbColor(0.5), a * uOpacity);
  }
`;

const HALO_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const HALO_FRAG = /* glsl */ `
  ${COLOR}
  uniform float uOpacity;
  uniform float uEnergy;
  uniform float uExpand;
  uniform float uPulse;
  uniform float uLevel;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float ring = exp(-pow((d - 0.62) * 4.5, 2.0)) * 0.55;
    float core = exp(-d * d * 3.2) * 0.55;
    float a = (ring + core) * (0.22 + 0.3 * uEnergy + 0.15 * uExpand + 0.2 * uPulse * uLevel);
    gl_FragColor = vec4(orbColor(0.35), a * uOpacity * smoothstep(1.0, 0.85, d));
  }
`;

const BEAM_VERT = /* glsl */ `
  varying float vY;
  void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const BEAM_FRAG = /* glsl */ `
  ${COLOR}
  uniform float uOpacity;
  uniform float uEnergy;
  varying float vY;
  void main() {
    float a = pow(1.0 - vY, 2.2) * 0.32 * (0.5 + 0.6 * uEnergy);
    gl_FragColor = vec4(orbColor(0.7), a * uOpacity);
  }
`;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface OrbEngineOptions {
  size: number;
  prefs: OrbPrefs;
  state: OrbState;
  /** False = draw a still frame on each change (Reduce Motion). */
  animate: boolean;
  /** Projector glow under the orb (main dashboard only). */
  showBase?: boolean;
  onContextLost?: () => void;
}

export interface OrbEngine {
  setState(state: OrbState): void;
  /** Live audio level 0–1 while speaking; null = use a synthetic envelope. */
  setLevel(level: number | null): void;
  setPrefs(prefs: OrbPrefs): void;
  setSize(size: number): void;
  /** Scatter the particles outward and let them reform (activation). */
  burst(): void;
  /** Stop/start the render loop (hidden tab, off-screen). */
  setPaused(paused: boolean): void;
  dispose(): void;
  readonly particleCount: number;
}

/** WebGL availability without leaving a context behind. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function createOrbEngine(canvas: HTMLCanvasElement, opts: OrbEngineOptions): OrbEngine {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'default', premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  const root = new Group();
  root.rotation.x = 0.18;
  scene.add(root);

  let prefs = opts.prefs;
  let state = opts.state;
  let targets = targetsFor(state);
  const cur = { ...targets, scatter: 0, level: 0 };
  let externalLevel: number | null = null;
  let paused = false;
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  let time = 1.5;
  let lastFrame = 0;

  const uniforms = {
    uTime: { value: time },
    uSpeed: { value: cur.speed },
    uExpand: { value: 0 },
    uSpiral: { value: 0 },
    uPulse: { value: 0 },
    uLevel: { value: 0 },
    uScatter: { value: 0 },
    uRadius: { value: 1 },
    uSize: { value: 2.4 },
    uPixelRatio: { value: 1 },
    uScan: { value: 0 },
    uEnergy: { value: cur.energy },
    uCore: { value: new Color() },
    uAccent: { value: new Color() },
    uHot: { value: new Color() },
    uError: { value: 0 },
    uDim: { value: 0 },
    uGlow: { value: 1 },
    uOpacity: { value: 1 },
  };

  const additive = (vertexShader: string, fragmentShader: string, extra: Record<string, { value: unknown }> = {}) =>
    new ShaderMaterial({
      uniforms: { ...uniforms, ...extra },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });

  // -- build -----------------------------------------------------------------

  const disposables: Array<{ dispose(): void }> = [];
  let count = 0;

  function build() {
    for (const d of disposables.splice(0)) d.dispose();
    root.clear();

    count = particleCount(prefs);
    const fancy = !prefs.reducedEffects;
    const shell = buildShell(count);
    const pairs = fancy ? buildLinks(shell, Math.min(1100, Math.floor(count / 5))) : [];

    // Shell
    const sg = new BufferGeometry();
    sg.setAttribute('aDir', new BufferAttribute(shell.dir, 3));
    sg.setAttribute('aRand', new BufferAttribute(shell.rand, 4));
    sg.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    sg.boundingSphere = null;
    const sm = additive(SHELL_VERT, POINT_FRAG);
    const shellPoints = new Points(sg, sm);
    shellPoints.frustumCulled = false;
    root.add(shellPoints);
    disposables.push(sg, sm);

    // Links
    if (pairs.length) {
      const ld = new Float32Array(pairs.length * 6);
      const lr = new Float32Array(pairs.length * 8);
      const lp = new Float32Array(pairs.length * 2);
      pairs.forEach(([i, j], k) => {
        ld.set(shell.dir.subarray(i * 3, i * 3 + 3), k * 6);
        ld.set(shell.dir.subarray(j * 3, j * 3 + 3), k * 6 + 3);
        lr.set(shell.rand.subarray(i * 4, i * 4 + 4), k * 8);
        lr.set(shell.rand.subarray(j * 4, j * 4 + 4), k * 8 + 4);
        const ph = (k * 0.618) % 1;
        lp[k * 2] = ph;
        lp[k * 2 + 1] = ph;
      });
      const lg = new BufferGeometry();
      lg.setAttribute('aDir', new BufferAttribute(ld, 3));
      lg.setAttribute('aRand', new BufferAttribute(lr, 4));
      lg.setAttribute('aPair', new BufferAttribute(lp, 1));
      lg.setAttribute('position', new BufferAttribute(new Float32Array(pairs.length * 6), 3));
      const lm = additive(LINK_VERT, LINK_FRAG);
      const lines = new LineSegments(lg, lm);
      lines.frustumCulled = false;
      root.add(lines);
      disposables.push(lg, lm);
    }

    // Energy streams with trails
    if (fancy) {
      const rnd = mulberry32(99);
      const ribbons = 6;
      const perRibbon = Math.floor(count / 14);
      const trail = 6;
      const total = ribbons * perRibbon * trail;
      const aU = new Float32Array(total * 3);
      const aV = new Float32Array(total * 3);
      const aS = new Float32Array(total * 4);
      let k = 0;
      for (let r = 0; r < ribbons; r++) {
        // Random orthonormal basis for this ribbon's plane.
        const ax = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
        const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
        const n = ax.map((v) => v / al);
        const t0 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const u = [n[1] * t0[2] - n[2] * t0[1], n[2] * t0[0] - n[0] * t0[2], n[0] * t0[1] - n[1] * t0[0]];
        const ul = Math.hypot(u[0], u[1], u[2]) || 1;
        const uu = u.map((v) => v / ul);
        const vv = [n[1] * uu[2] - n[2] * uu[1], n[2] * uu[0] - n[0] * uu[2], n[0] * uu[1] - n[1] * uu[0]];
        const speed = (0.35 + rnd() * 0.5) * (r % 2 ? -1 : 1);
        for (let i = 0; i < perRibbon; i++) {
          const ang = rnd() * Math.PI * 2;
          const off = (rnd() - 0.5) * 2;
          for (let tr = 0; tr < trail; tr++, k++) {
            aU.set(uu, k * 3);
            aV.set(vv, k * 3);
            aS.set([ang, off, speed, tr], k * 4);
          }
        }
      }
      const stg = new BufferGeometry();
      stg.setAttribute('aU', new BufferAttribute(aU, 3));
      stg.setAttribute('aV', new BufferAttribute(aV, 3));
      stg.setAttribute('aS', new BufferAttribute(aS, 4));
      stg.setAttribute('position', new BufferAttribute(new Float32Array(total * 3), 3));
      const stm = additive(STREAM_VERT, POINT_FRAG);
      const streams = new Points(stg, stm);
      streams.frustumCulled = false;
      root.add(streams);
      disposables.push(stg, stm);
    }

    // Orbital rings (rotated on the CPU: three cheap transforms per frame)
    rings.length = 0;
    [
      [1.32, 1.25, 0.0, 24, 0.05],
      [1.48, 0.35, 0.9, 40, -0.035],
      [1.62, -0.55, -0.4, 60, 0.025],
    ].forEach(([radius, tiltX, tiltZ, dash, spin]) => {
      const segs = 256;
      const pos = new Float32Array(segs * 3);
      const at = new Float32Array(segs);
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pos.set([Math.cos(a) * radius, 0, Math.sin(a) * radius], i * 3);
        at[i] = i / segs;
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('aT', new BufferAttribute(at, 1));
      const m = additive(RING_VERT, RING_FRAG, { uDash: { value: dash }, uSpin: { value: spin * 6 } });
      const ring = new LineLoop(g, m);
      ring.rotation.set(tiltX, 0, tiltZ);
      root.add(ring);
      rings.push({ obj: ring, spin });
      disposables.push(g, m);
    });

    // Projector base: flattened rings and a light beam up into the orb.
    if (opts.showBase) {
      const base = new Group();
      base.position.y = -1.55;
      [0.55, 0.85, 1.15].forEach((radius, i) => {
        const segs = 128;
        const pos = new Float32Array(segs * 3);
        const at = new Float32Array(segs);
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          pos.set([Math.cos(a) * radius, 0, Math.sin(a) * radius], s * 3);
          at[s] = s / segs;
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(pos, 3));
        g.setAttribute('aT', new BufferAttribute(at, 1));
        const m = additive(RING_VERT, RING_FRAG, { uDash: { value: 12 + i * 10 }, uSpin: { value: (i % 2 ? -1 : 1) * 0.15 } });
        base.add(new LineLoop(g, m));
        disposables.push(g, m);
      });
      const beamGeo = new CylinderGeometry(0.35, 0.95, 1.6, 48, 1, true);
      beamGeo.translate(0, 0.8, 0);
      const beamMat = new ShaderMaterial({
        uniforms,
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
      base.add(new Mesh(beamGeo, beamMat));
      disposables.push(beamGeo, beamMat);
      scene.add(base);
      baseGroup = base;
    }
  }

  const rings: Array<{ obj: LineLoop; spin: number }> = [];

  // Halo lives in the scene (not the rotating root) so it always faces the camera.
  const haloGeo = new PlaneGeometry(4.4, 4.4);
  const haloMat = new ShaderMaterial({
    uniforms,
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const halo = new Mesh(haloGeo, haloMat);
  halo.position.z = -1.2;
  halo.renderOrder = -1;
  scene.add(halo);
  let baseGroup: Group | null = null;

  function applyPrefs() {
    const pal = ORB_PALETTES[prefs.palette];
    uniforms.uCore.value.set(pal.core);
    uniforms.uAccent.value.set(pal.accent);
    uniforms.uHot.value.set(pal.hot);
    uniforms.uGlow.value = prefs.glow;
  }

  function setSize(size: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, prefs.reducedEffects ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size, size, false);
    uniforms.uPixelRatio.value = dpr;
    // Point size scales with the orb so small orbs aren't a blur of dots.
    uniforms.uSize.value = (2.2 * size) / 240 * (prefs.reducedEffects ? 1.4 : 1);
    camera.aspect = 1;
    camera.position.set(0, opts.showBase ? 0.15 : 0, opts.showBase ? 6.6 : 5.6);
    camera.lookAt(0, opts.showBase ? -0.35 : 0, 0);
    camera.updateProjectionMatrix();
  }

  // -- loop -------------------------------------------------------------------

  function step(dt: number) {
    const k = 1 - Math.exp(-dt * 4.5);
    for (const key of ['energy', 'expand', 'spiral', 'speed', 'pulse', 'scan', 'error', 'dim'] as const) {
      cur[key] = lerp(cur[key], targets[key], k);
    }
    cur.scatter = lerp(cur.scatter, 0, 1 - Math.exp(-dt * 2.6));
    // Speaking: real audio level when provided, otherwise a speech-like envelope.
    const synthetic = 0.5 + 0.5 * Math.sin(time * 7.3) * Math.sin(time * 2.1 + 1) * (0.6 + 0.4 * Math.sin(time * 13.7));
    cur.level = lerp(cur.level, externalLevel ?? synthetic, 1 - Math.exp(-dt * 18));

    time += dt * cur.speed * prefs.speed * 2.2;
    uniforms.uTime.value = time;
    uniforms.uSpeed.value = cur.speed;
    uniforms.uExpand.value = cur.expand;
    uniforms.uSpiral.value = cur.spiral;
    uniforms.uPulse.value = cur.pulse;
    uniforms.uLevel.value = cur.level;
    uniforms.uScatter.value = cur.scatter;
    uniforms.uScan.value = cur.scan;
    uniforms.uEnergy.value = cur.energy;
    uniforms.uError.value = cur.error;
    uniforms.uDim.value = cur.dim;

    root.rotation.y += dt * 0.12 * prefs.speed * (0.4 + cur.speed);
    for (const r of rings) r.obj.rotation.y += dt * r.spin * 4 * prefs.speed * (0.5 + cur.speed);
    if (baseGroup) baseGroup.rotation.y -= dt * 0.08 * prefs.speed;
  }

  function frame(now: number) {
    if (disposed || paused) return;
    raf = requestAnimationFrame(frame);
    const minInterval = prefs.reducedEffects ? 1000 / 30 : 1000 / 60;
    if (now - lastFrame < minInterval - 1) return;
    lastFrame = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);
    renderer.render(scene, camera);
  }

  function still() {
    // Reduce Motion: jump straight to the target look and draw once.
    Object.assign(cur, targets, { scatter: 0, level: 0.5 });
    step(0);
    renderer.render(scene, camera);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (!opts.animate) {
      still();
      return;
    }
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    opts.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  applyPrefs();
  build();
  setSize(opts.size);
  if (opts.animate) cur.scatter = 1.1; // first appearance: particles converge into the sphere
  start();

  return {
    get particleCount() {
      return count;
    },
    setState(next) {
      if (next === 'activating' && state !== 'activating') cur.scatter = 1.1;
      state = next;
      targets = targetsFor(next);
      if (!opts.animate) still();
    },
    setLevel(level) {
      externalLevel = level === null ? null : Math.max(0, Math.min(1, level));
    },
    setPrefs(next) {
      const rebuild = next.density !== prefs.density || next.reducedEffects !== prefs.reducedEffects;
      prefs = next;
      applyPrefs();
      if (rebuild) {
        if (baseGroup) {
          scene.remove(baseGroup);
          baseGroup = null;
        }
        build();
      }
      setSize(opts.size);
      if (!opts.animate) still();
    },
    setSize(size) {
      opts.size = size;
      setSize(size);
      if (!opts.animate) still();
    },
    burst() {
      cur.scatter = 1.1;
      if (!opts.animate) still();
    },
    setPaused(p) {
      if (p === paused) return;
      paused = p;
      if (!p) start();
      else cancelAnimationFrame(raf);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const d of disposables.splice(0)) d.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      renderer.dispose();
      // iOS caps live WebGL contexts per page; release ours immediately.
      renderer.forceContextLoss();
    },
  };
}

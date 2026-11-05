import { create } from 'zustand';

/**
 * Orb appearance, saved on this device only. Read/write failures (private
 * mode, blocked storage) fall back to defaults; nothing here is essential.
 */

export const ORB_PALETTES = {
  electric: { label: 'Electric blue', core: '#00b3ff', accent: '#5ce1ff', hot: '#ffffff' },
  cyan: { label: 'Cyan', core: '#00e5ff', accent: '#8ff7ff', hot: '#ffffff' },
  violet: { label: 'Violet', core: '#7a5cff', accent: '#c3a8ff', hot: '#ffffff' },
  emerald: { label: 'Emerald', core: '#00d68f', accent: '#7dffcf', hot: '#f0fff8' },
  inferno: { label: 'Inferno', core: '#ff4d2e', accent: '#ffb347', hot: '#fff3d6' },
} as const;

export type OrbPalette = keyof typeof ORB_PALETTES;
export type OrbDensity = 'low' | 'medium' | 'high';

export interface OrbPrefs {
  palette: OrbPalette;
  density: OrbDensity;
  /** Multiplier on the orb's base size, 0.7–1.3. */
  scale: number;
  /** Multiplier on animation speed, 0.5–1.8. */
  speed: number;
  /** Glow strength, 0.4–1.6. */
  glow: number;
  /** Fewer particles, no links/trails, 30 fps: for battery or older phones. */
  reducedEffects: boolean;
}

export const DEFAULT_ORB_PREFS: OrbPrefs = {
  palette: 'electric',
  density: 'medium',
  scale: 1,
  speed: 1,
  glow: 1,
  reducedEffects: false,
};

/** Particle counts per density. Reduced effects caps everything at 1,800. */
export const PARTICLE_COUNTS: Record<OrbDensity, number> = { low: 2500, medium: 5000, high: 9000 };
export const REDUCED_PARTICLES = 1800;

const KEY = 'hell-orb-prefs-v1';
const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Validate untrusted stored data field by field. */
export function sanitizeOrbPrefs(raw: unknown): OrbPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    palette: typeof r.palette === 'string' && r.palette in ORB_PALETTES ? (r.palette as OrbPalette) : DEFAULT_ORB_PREFS.palette,
    density: r.density === 'low' || r.density === 'medium' || r.density === 'high' ? r.density : DEFAULT_ORB_PREFS.density,
    scale: clamp(r.scale, 0.7, 1.3, DEFAULT_ORB_PREFS.scale),
    speed: clamp(r.speed, 0.5, 1.8, DEFAULT_ORB_PREFS.speed),
    glow: clamp(r.glow, 0.4, 1.6, DEFAULT_ORB_PREFS.glow),
    reducedEffects: typeof r.reducedEffects === 'boolean' ? r.reducedEffects : DEFAULT_ORB_PREFS.reducedEffects,
  };
}

function load(): OrbPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeOrbPrefs(JSON.parse(raw)) : { ...DEFAULT_ORB_PREFS };
  } catch {
    return { ...DEFAULT_ORB_PREFS };
  }
}

interface OrbPrefsStore extends OrbPrefs {
  update: (changes: Partial<OrbPrefs>) => void;
  reset: () => void;
}

function save(prefs: OrbPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not persisted this session; the in-memory value still applies.
  }
}

const pick = (s: OrbPrefs): OrbPrefs => ({
  palette: s.palette,
  density: s.density,
  scale: s.scale,
  speed: s.speed,
  glow: s.glow,
  reducedEffects: s.reducedEffects,
});

export const useOrbPrefs = create<OrbPrefsStore>((set, get) => ({
  ...load(),
  update: (changes) => {
    const next = sanitizeOrbPrefs({ ...pick(get()), ...changes });
    save(next);
    set(next);
  },
  reset: () => {
    save(DEFAULT_ORB_PREFS);
    set({ ...DEFAULT_ORB_PREFS });
  },
}));

export function particleCount(prefs: Pick<OrbPrefs, 'density' | 'reducedEffects'>): number {
  return prefs.reducedEffects ? REDUCED_PARTICLES : PARTICLE_COUNTS[prefs.density];
}

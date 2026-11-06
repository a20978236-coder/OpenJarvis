import { create } from 'zustand';

/**
 * Interface look (saved on this device): brightness (a dimmer, handy at
 * night), glow intensity of panels and buttons, and animation intensity.
 *  - full: everything moves;
 *  - calm: decorative animations stop and the orb moves slowly;
 *  - off: no animation at all (the orb is drawn still).
 */
export type AnimationLevel = 'full' | 'calm' | 'off';

export interface UiPrefs {
  brightness: number;
  glow: number;
  animation: AnimationLevel;
}

export const UI_LIMITS = { brightness: [0.4, 1] as [number, number], glow: [0, 1.6] as [number, number] };
export const DEFAULT_UI: UiPrefs = { brightness: 1, glow: 1, animation: 'full' };
const KEY = 'hell-ui-v1';

export function sanitizeUi(raw: unknown): UiPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof UiPrefs, unknown>>;
  const num = (v: unknown, [lo, hi]: [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 100) / 100)) : d);
  return {
    brightness: num(r.brightness, UI_LIMITS.brightness, DEFAULT_UI.brightness),
    glow: num(r.glow, UI_LIMITS.glow, DEFAULT_UI.glow),
    animation: r.animation === 'calm' || r.animation === 'off' ? r.animation : 'full',
  };
}

function load(): UiPrefs {
  try {
    const s = localStorage.getItem(KEY);
    return sanitizeUi(s ? JSON.parse(s) : null);
  } catch {
    return { ...DEFAULT_UI };
  }
}

/** Push the prefs onto <html> as CSS variables / attributes. */
export function applyUi(p: UiPrefs, root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (!root) return;
  root.style.setProperty('--hell-dim', String(Math.round((1 - p.brightness) * 100) / 100));
  root.style.setProperty('--hell-glow', String(p.glow));
  root.dataset.anim = p.animation;
}

interface Store extends UiPrefs {
  update: (patch: Partial<UiPrefs>) => void;
  reset: () => void;
}

export const useUiPrefs = create<Store>((set, get) => {
  const commit = (next: UiPrefs) => {
    set(next);
    applyUi(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // not saved
    }
  };
  const initial = load();
  applyUi(initial);
  return {
    ...initial,
    update: (patch) => {
      const { brightness, glow, animation } = get();
      commit(sanitizeUi({ brightness, glow, animation, ...patch }));
    },
    reset: () => commit({ ...DEFAULT_UI }),
  };
});

/** True when motion should stop: the iOS setting or HELL's own "off". */
export function motionOff(): boolean {
  const sys = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return sys || useUiPrefs.getState().animation === 'off';
}

import { create } from 'zustand';
import { MODULES } from '../dashboard/modules';
import { DEFAULT_RECOGNIZER, GESTURE_NAMES, type GestureName, type RecognizerOptions } from './gesture-recognizer';

/** What a gesture does. Each one also has an on-screen button. */
export type GestureAction =
  | 'open-hell'
  | 'minimize'
  | 'prev-module'
  | 'next-module'
  | 'listen'
  | 'open-settings'
  | 'expand-holo'
  | 'collapse-holo'
  | 'none';

export const ACTION_LABELS: Record<GestureAction, string> = {
  'open-hell': 'Open HELL',
  minimize: 'Minimize the interface',
  'prev-module': 'Previous module',
  'next-module': 'Next module',
  listen: 'Start listening',
  'open-settings': 'Open settings',
  'expand-holo': 'Expand the hologram',
  'collapse-holo': 'Collapse the hologram',
  none: 'Nothing',
};

export const GESTURE_LABELS: Record<GestureName, string> = {
  'swipe-up': 'Swipe up',
  'swipe-down': 'Swipe down',
  'swipe-left': 'Swipe left',
  'swipe-right': 'Swipe right',
  'double-tap': 'Double tap',
  'long-press': 'Long press',
  'pinch-out': 'Pinch out',
  'pinch-in': 'Pinch in',
};

/** The Phase 6 spec's assignments. */
export const DEFAULT_MAP: Record<GestureName, GestureAction> = {
  'swipe-up': 'open-hell',
  'swipe-down': 'minimize',
  'swipe-left': 'prev-module',
  'swipe-right': 'next-module',
  'double-tap': 'listen',
  'long-press': 'open-settings',
  'pinch-out': 'expand-holo',
  'pinch-in': 'collapse-holo',
};

export interface GestureSettings {
  enabled: boolean;
  /** Show a short label when a gesture is recognised. */
  feedback: boolean;
  /** Recognizer thresholds (tuned in Calibration, Stage F). */
  tuning: Tuning;
  map: Record<GestureName, GestureAction>;
  /** Left-handed mode swaps what swipe left and swipe right do. */
  hand: 'right' | 'left';
}

export type Tuning = Pick<RecognizerOptions, 'swipeDistance' | 'swipeMaxMs' | 'minVelocity' | 'dominance' | 'pinchRatio' | 'doubleTapMs' | 'longPressMs'>;

/**
 * Safe ranges for every tunable. The floors stop calibration from making
 * gestures hair-trigger (accidental activation); the ceilings keep them
 * reachable.
 */
export const TUNING_LIMITS: Record<keyof Tuning, [number, number]> = {
  swipeDistance: [40, 180],
  swipeMaxMs: [300, 1300],
  minVelocity: [0.1, 0.8],
  dominance: [1.2, 3],
  pinchRatio: [0.12, 0.6],
  doubleTapMs: [180, 600],
  longPressMs: [350, 1400],
};

export const DEFAULT_SETTINGS: GestureSettings = {
  enabled: true,
  feedback: true,
  tuning: {
    swipeDistance: DEFAULT_RECOGNIZER.swipeDistance,
    swipeMaxMs: DEFAULT_RECOGNIZER.swipeMaxMs,
    minVelocity: DEFAULT_RECOGNIZER.minVelocity,
    dominance: DEFAULT_RECOGNIZER.dominance,
    pinchRatio: DEFAULT_RECOGNIZER.pinchRatio,
    doubleTapMs: DEFAULT_RECOGNIZER.doubleTapMs,
    longPressMs: DEFAULT_RECOGNIZER.longPressMs,
  },
  map: DEFAULT_MAP,
  hand: 'right',
};

/** The action for `g`, with left-handed mode applied. */
export function effectiveAction(s: Pick<GestureSettings, 'map' | 'hand'>, g: GestureName): GestureAction {
  if (s.hand === 'left') {
    if (g === 'swipe-left') return s.map['swipe-right'];
    if (g === 'swipe-right') return s.map['swipe-left'];
  }
  return s.map[g];
}

const KEY = 'hell-gestures-v1';
const ACTIONS = Object.keys(ACTION_LABELS) as GestureAction[];
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** Accepts anything (old/corrupt storage) and returns valid settings. */
export function sanitizeSettings(raw: unknown): GestureSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<GestureSettings>;
  const t = (r.tuning && typeof r.tuning === 'object' ? r.tuning : {}) as Partial<GestureSettings['tuning']>;
  const d = DEFAULT_SETTINGS.tuning;
  const map = { ...DEFAULT_MAP };
  if (r.map && typeof r.map === 'object') {
    for (const g of GESTURE_NAMES) {
      const a = (r.map as Record<string, unknown>)[g];
      if (typeof a === 'string' && (ACTIONS as string[]).includes(a)) map[g] = a as GestureAction;
    }
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    feedback: typeof r.feedback === 'boolean' ? r.feedback : true,
    tuning: Object.fromEntries(
      (Object.keys(TUNING_LIMITS) as (keyof Tuning)[]).map((k) => [k, clamp(t[k], TUNING_LIMITS[k][0], TUNING_LIMITS[k][1], d[k])]),
    ) as unknown as Tuning,
    hand: r.hand === 'left' ? 'left' : 'right',
    map,
  };
}

function load(): GestureSettings {
  try {
    const s = localStorage.getItem(KEY);
    return sanitizeSettings(s ? JSON.parse(s) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

interface GestureStore extends GestureSettings {
  /** Dashboard shown in full, or minimised to the orb. Not saved. */
  dashView: 'full' | 'minimized';
  update: (patch: Partial<GestureSettings>) => void;
  reset: () => void;
  setDashView: (v: 'full' | 'minimized') => void;
}

export const useGestures = create<GestureStore>((set, get) => {
  const save = () => {
    const { enabled, feedback, tuning, map, hand } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled, feedback, tuning, map, hand }));
    } catch {
      // Not saved; applies for this session.
    }
  };
  return {
    ...load(),
    dashView: 'full',
    update: (patch) => {
      const { enabled, feedback, tuning, map, hand } = get();
      set(sanitizeSettings({ enabled, feedback, tuning, map, hand, ...patch }));
      save();
    },
    reset: () => {
      set(sanitizeSettings(null));
      save();
    },
    setDashView: (dashView) => set({ dashView }),
  };
});

// ---- Module order for swipe left / right ---------------------------------

export interface CarouselEntry {
  id: string;
  label: string;
  route: string;
}

/** HELL home first, then the modules that work today, in dashboard order. */
export function carousel(): CarouselEntry[] {
  return [{ id: 'home', label: 'HELL', route: '/m' }, ...MODULES.filter((m) => m.stage === null).map((m) => ({ id: m.id, label: m.label, route: m.route }))];
}

/** Which carousel entry is on screen (-1 when the page isn't one, e.g. Chat). */
export function carouselIndex(pathname: string, search: string, list = carousel()): number {
  const path = pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search);
  let best = -1;
  list.forEach((e, i) => {
    const [p, q] = e.route.split('?');
    if (p !== path) return;
    if (q) {
      const want = new URLSearchParams(q);
      for (const [k, v] of want) if (params.get(k) !== v) return;
      best = i;
    } else if (best === -1) {
      // A bare route only matches when no more specific entry (with a
      // query, e.g. Notes = Tasks?view=notes) claims it.
      const claimed = list.some((o) => {
        const [op, oq] = o.route.split('?');
        if (op !== path || !oq) return false;
        return [...new URLSearchParams(oq)].every(([k, v]) => params.get(k) === v);
      });
      if (!claimed) best = i;
    }
  });
  return best;
}

/** The entry one step away (wraps around). */
export function stepCarousel(pathname: string, search: string, dir: 1 | -1, list = carousel()): CarouselEntry | null {
  const i = carouselIndex(pathname, search, list);
  if (i < 0) return null;
  return list[(i + dir + list.length) % list.length];
}

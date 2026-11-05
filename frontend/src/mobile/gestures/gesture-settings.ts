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
  tuning: Pick<RecognizerOptions, 'swipeDistance' | 'swipeMaxMs' | 'pinchRatio' | 'doubleTapMs' | 'longPressMs'>;
  map: Record<GestureName, GestureAction>;
}

export const DEFAULT_SETTINGS: GestureSettings = {
  enabled: true,
  feedback: true,
  tuning: {
    swipeDistance: DEFAULT_RECOGNIZER.swipeDistance,
    swipeMaxMs: DEFAULT_RECOGNIZER.swipeMaxMs,
    pinchRatio: DEFAULT_RECOGNIZER.pinchRatio,
    doubleTapMs: DEFAULT_RECOGNIZER.doubleTapMs,
    longPressMs: DEFAULT_RECOGNIZER.longPressMs,
  },
  map: DEFAULT_MAP,
};

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
    tuning: {
      swipeDistance: clamp(t.swipeDistance, 30, 200, d.swipeDistance),
      swipeMaxMs: clamp(t.swipeMaxMs, 250, 1500, d.swipeMaxMs),
      pinchRatio: clamp(t.pinchRatio, 0.1, 0.8, d.pinchRatio),
      doubleTapMs: clamp(t.doubleTapMs, 180, 600, d.doubleTapMs),
      longPressMs: clamp(t.longPressMs, 350, 1500, d.longPressMs),
    },
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
    const { enabled, feedback, tuning, map } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled, feedback, tuning, map }));
    } catch {
      // Not saved; applies for this session.
    }
  };
  return {
    ...load(),
    dashView: 'full',
    update: (patch) => {
      const { enabled, feedback, tuning, map } = get();
      set(sanitizeSettings({ enabled, feedback, tuning, map, ...patch }));
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

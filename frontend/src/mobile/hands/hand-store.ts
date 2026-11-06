import { create } from 'zustand';
import { DEFAULT_STABILIZER, type HandGesture } from './hand-logic';

export type HandStatus = 'off' | 'loading' | 'on' | 'error';

export interface HandSettings {
  /** How long a gesture must be held, ms. */
  holdMs: number;
  /** Minimum recogniser confidence, 0..1. */
  minScore: number;
  /** Turn off after this long with no hand in view, seconds. */
  idleOffSec: number;
}

export const HAND_LIMITS: Record<keyof HandSettings, [number, number]> = {
  holdMs: [300, 1500],
  minScore: [0.4, 0.9],
  idleOffSec: [30, 300],
};

export const DEFAULT_HAND_SETTINGS: HandSettings = { holdMs: DEFAULT_STABILIZER.holdMs, minScore: 0.6, idleOffSec: 90 };

const KEY = 'hell-hands-v1';
const clamp = (v: unknown, [lo, hi]: [number, number], d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function sanitizeHandSettings(raw: unknown): HandSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<HandSettings>;
  return {
    holdMs: clamp(r.holdMs, HAND_LIMITS.holdMs, DEFAULT_HAND_SETTINGS.holdMs),
    minScore: clamp(r.minScore, HAND_LIMITS.minScore, DEFAULT_HAND_SETTINGS.minScore),
    idleOffSec: clamp(r.idleOffSec, HAND_LIMITS.idleOffSec, DEFAULT_HAND_SETTINGS.idleOffSec),
  };
}

function load(): HandSettings {
  try {
    const s = localStorage.getItem(KEY);
    return sanitizeHandSettings(s ? JSON.parse(s) : null);
  } catch {
    return sanitizeHandSettings(null);
  }
}

interface HandStore {
  /** The user asked for hand gestures (session only: never auto-starts). */
  wanted: boolean;
  status: HandStatus;
  error: string | null;
  /** What the camera sees right now (for the self-view label). */
  seen: { gesture: HandGesture | null; progress: number; handSeen: boolean; raw?: { category: string; score: number } };
  settings: HandSettings;
  setWanted: (on: boolean) => void;
  setStatus: (status: HandStatus, error?: string | null) => void;
  setSeen: (seen: HandStore['seen']) => void;
  updateSettings: (patch: Partial<HandSettings>) => void;
}

export const useHands = create<HandStore>((set, get) => ({
  wanted: false,
  status: 'off',
  error: null,
  seen: { gesture: null, progress: 0, handSeen: false },
  settings: load(),
  setWanted: (wanted) => set({ wanted, ...(wanted ? {} : { status: 'off', seen: { gesture: null, progress: 0, handSeen: false } }) }),
  setStatus: (status, error = null) => set({ status, error }),
  setSeen: (seen) => set({ seen }),
  updateSettings: (patch) => {
    const settings = sanitizeHandSettings({ ...get().settings, ...patch });
    set({ settings });
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Not saved; applies for this session.
    }
  },
}));

import { create } from 'zustand';

/** Application errors seen in this session (for Diagnostics). Kept on this device only. */
export interface AppError {
  t: number;
  message: string;
  source: string;
}

const KEY = 'hell-errors-v1';
const MAX = 30;

function load(): AppError[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.message === 'string').slice(-MAX) : [];
  } catch {
    return [];
  }
}

export const useErrorLog = create<{ errors: AppError[]; clear: () => void }>((set) => ({
  errors: load(),
  clear: () => {
    set({ errors: [] });
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  },
}));

export function recordError(message: string, source = 'app'): void {
  const msg = String(message || 'Unknown error').slice(0, 300);
  const errors = [...useErrorLog.getState().errors, { t: Date.now(), message: msg, source }].slice(-MAX);
  useErrorLog.setState({ errors });
  try {
    sessionStorage.setItem(KEY, JSON.stringify(errors));
  } catch {
    // ignore
  }
}

let installed = false;
/** Capture uncaught errors and unhandled promise rejections. */
export function installErrorLog(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (e: ErrorEvent) => {
    if (!e.message) return; // resource load errors carry no message
    recordError(e.message, e.filename ? e.filename.split('/').pop() || 'script' : 'script');
  });
  target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason as { message?: string } | string | undefined;
    const msg = typeof r === 'string' ? r : r?.message ?? 'Unhandled promise rejection';
    if (/AbortError|aborted/i.test(msg)) return; // user cancellations are not errors
    recordError(msg, 'promise');
  });
}

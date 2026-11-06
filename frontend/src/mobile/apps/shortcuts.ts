import { create } from 'zustand';

/**
 * Buttons that run your iOS Shortcuts (saved on this device). HELL opens
 * `shortcuts://run-shortcut?name=…`; iOS runs that shortcut from the
 * Shortcuts app (it must exist there, with exactly this name).
 */
export interface ShortcutButton {
  id: string;
  /** Label on the button. */
  label: string;
  /** Exact name of the shortcut in the Shortcuts app. */
  shortcut: string;
  /** Optional text passed to the shortcut as input. */
  input: string;
}

const KEY = 'hell-shortcuts-v1';
const MAX = 40;

export function sanitizeShortcuts(raw: unknown): ShortcutButton[] {
  if (!Array.isArray(raw)) return [];
  const out: ShortcutButton[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const shortcut = typeof o.shortcut === 'string' ? o.shortcut.trim().slice(0, 100) : '';
    if (!shortcut) continue;
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 40) : Math.random().toString(36).slice(2),
      label: (typeof o.label === 'string' && o.label.trim() ? o.label.trim() : shortcut).slice(0, 40),
      shortcut,
      input: typeof o.input === 'string' ? o.input.slice(0, 500) : '',
    });
  }
  return out.slice(0, MAX);
}

/** The URL iOS uses to run a shortcut. */
export function shortcutUrl(s: Pick<ShortcutButton, 'shortcut' | 'input'>, input?: string): string {
  const text = input ?? s.input;
  let url = `shortcuts://run-shortcut?name=${encodeURIComponent(s.shortcut)}`;
  if (text) url += `&input=text&text=${encodeURIComponent(text)}`;
  return url;
}

/** "Run shortcut Lights off" / "start the shortcut called X" → the matching saved button. */
export function matchShortcutCommand(text: string, buttons: ShortcutButton[]): ShortcutButton | null {
  const m = /^\s*(?:hey\s+hell[,\s]+)?(?:please\s+)?(?:run|start|launch|open|do)\s+(?:the\s+|my\s+)?shortcut\s+(?:called\s+|named\s+)?["“]?(.+?)["”]?[.!?\s]*$/i.exec(text);
  if (!m) return null;
  const want = m[1].trim().toLowerCase();
  return buttons.find((b) => b.shortcut.toLowerCase() === want || b.label.toLowerCase() === want) ?? null;
}

function load(): ShortcutButton[] {
  try {
    const s = localStorage.getItem(KEY);
    return sanitizeShortcuts(s ? JSON.parse(s) : []);
  } catch {
    return [];
  }
}

interface Store {
  buttons: ShortcutButton[];
  add: (b: Omit<ShortcutButton, 'id'>) => void;
  remove: (id: string) => void;
}

export const useShortcuts = create<Store>((set, get) => {
  const save = (buttons: ShortcutButton[]) => {
    set({ buttons });
    try {
      localStorage.setItem(KEY, JSON.stringify(buttons));
    } catch {
      // not saved
    }
  };
  return {
    buttons: load(),
    add: (b) => save(sanitizeShortcuts([...get().buttons, { ...b, id: Math.random().toString(36).slice(2) }])),
    remove: (id) => save(get().buttons.filter((b) => b.id !== id)),
  };
});

/** Open the Shortcuts app with this shortcut. */
export function runShortcut(b: ShortcutButton, input?: string): void {
  window.location.href = shortcutUrl(b, input);
}

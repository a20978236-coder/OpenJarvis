import { create } from 'zustand';
import { applyOp, starterLayout, type HoloOp } from './holo-ops';
import { sanitizeLayout, type HoloLayout } from './holo-types';

/**
 * Editor state: the layout, selection, and undo/redo history.
 *
 * Continuous edits (dragging, sliders) are applied as *transient* ops that
 * update the view live; `commitGesture` then records the whole gesture as a
 * single undo step. A draft is kept on this device so a reload (or iOS
 * evicting the page) doesn't lose work.
 */

const HISTORY_LIMIT = 100;
const DRAFT_KEY = 'hell-holo-draft-v1';

interface Draft {
  layout: HoloLayout;
  savedId: string | null;
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { layout: sanitizeLayout(d?.layout), savedId: typeof d?.savedId === 'string' ? d.savedId : null };
    }
  } catch {
    // Fall through to a fresh layout.
  }
  return { layout: starterLayout(), savedId: null };
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;
function writeDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // Storage full or blocked; the server copy is the durable one.
  }
}
/** Debounced for rapid edits; `now` for open/new/save, which must not be lost. */
function saveDraft(d: Draft, now = false) {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = null;
  if (now) writeDraft(d);
  else draftTimer = setTimeout(() => writeDraft(d), 400);
}

export interface HoloState {
  layout: HoloLayout;
  selectedId: string | null;
  past: HoloLayout[];
  future: HoloLayout[];
  /** Layout before the current drag/slider gesture began. */
  gestureBase: HoloLayout | null;
  /** Server id of the layout being edited, once saved. */
  savedId: string | null;
  /** True when there are edits since the last save. */
  dirty: boolean;
  snap: boolean;
  mode: 'edit' | 'preview' | 'fullscreen';

  /** Apply one op as an undoable step. Returns an error message, if any. */
  apply: (op: HoloOp) => string | undefined;
  /** Apply several ops as ONE undoable step (used by the AI builder). */
  applyMany: (ops: HoloOp[]) => { applied: number; errors: string[] };
  /** Live update during a gesture; not recorded until commitGesture. */
  applyTransient: (op: HoloOp) => void;
  commitGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  setSnap: (on: boolean) => void;
  setMode: (mode: HoloState['mode']) => void;
  /** Replace the whole layout (load / new); clears history. */
  replace: (layout: HoloLayout, savedId: string | null) => void;
  markSaved: (id: string) => void;
}

const initial = loadDraft();

export const useHolo = create<HoloState>((set, get) => {
  const commit = (next: HoloLayout, selectedId?: string | null) => {
    const { layout, past, savedId } = get();
    if (next === layout) return;
    const p = [...past, layout].slice(-HISTORY_LIMIT);
    set({ layout: next, past: p, future: [], dirty: true, ...(selectedId !== undefined ? { selectedId } : {}) });
    saveDraft({ layout: next, savedId });
  };

  return {
    layout: initial.layout,
    selectedId: null,
    past: [],
    future: [],
    gestureBase: null,
    savedId: initial.savedId,
    dirty: false,
    snap: true,
    mode: 'edit',

    apply: (op) => {
      const { layout, selectedId } = get();
      const r = applyOp(layout, op);
      if (r.error) return r.error;
      let sel: string | null | undefined = r.createdId;
      if (op.op === 'remove' && selectedId === op.id) sel = null;
      if (op.op === 'clear') sel = null;
      commit(r.layout, sel);
      return undefined;
    },

    applyMany: (ops) => {
      const errors: string[] = [];
      let layout = get().layout;
      let created: string | undefined;
      let applied = 0;
      for (const op of ops) {
        const r = applyOp(layout, op);
        if (r.error) errors.push(r.error);
        else {
          layout = r.layout;
          applied++;
          if (r.createdId) created = r.createdId;
        }
      }
      if (applied) commit(layout, created ?? (get().selectedId && layout.objects.some((o) => o.id === get().selectedId) ? undefined : null));
      return { applied, errors };
    },

    applyTransient: (op) => {
      const { layout, gestureBase } = get();
      const r = applyOp(layout, op);
      if (r.error) return;
      set({ layout: r.layout, gestureBase: gestureBase ?? layout, dirty: true });
    },

    commitGesture: () => {
      const { gestureBase, layout, past, savedId } = get();
      if (!gestureBase) return;
      if (gestureBase !== layout) {
        set({ past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [], gestureBase: null });
        saveDraft({ layout, savedId });
      } else set({ gestureBase: null });
    },

    undo: () => {
      const { past, layout, future, selectedId, savedId } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        layout: prev,
        past: past.slice(0, -1),
        future: [layout, ...future].slice(0, HISTORY_LIMIT),
        dirty: true,
        selectedId: selectedId && prev.objects.some((o) => o.id === selectedId) ? selectedId : null,
      });
      saveDraft({ layout: prev, savedId });
    },

    redo: () => {
      const { past, layout, future, selectedId, savedId } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        layout: next,
        past: [...past, layout].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        dirty: true,
        selectedId: selectedId && next.objects.some((o) => o.id === selectedId) ? selectedId : null,
      });
      saveDraft({ layout: next, savedId });
    },

    select: (id) => set({ selectedId: id }),
    setSnap: (on) => set({ snap: on }),
    setMode: (mode) => set({ mode, selectedId: mode === 'edit' ? get().selectedId : null }),
    replace: (layout, savedId) => {
      const clean = sanitizeLayout(layout);
      set({ layout: clean, savedId, past: [], future: [], gestureBase: null, selectedId: null, dirty: false });
      saveDraft({ layout: clean, savedId }, true);
    },
    markSaved: (id) => {
      set({ savedId: id, dirty: false });
      saveDraft({ layout: get().layout, savedId: id }, true);
    },
  };
});

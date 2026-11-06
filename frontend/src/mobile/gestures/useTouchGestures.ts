import { useEffect, useRef, type RefObject } from 'react';
import { ALLOW_NONE, createGestureRecognizer, DEFAULT_RECOGNIZER, type Allow, type GestureName } from './gesture-recognizer';
import { useGestures } from './gesture-settings';

/**
 * Where gestures apply:
 *  - dashboard: every gesture;
 *  - page: left/right swipes only (vertical scrolling and pinch-zoom stay
 *    the browser's);
 *  - fullscreen: pinch only (the presented hologram);
 *  - off: nothing (a sheet is open).
 * The Hologram Builder's 3D canvas never starts a gesture: it owns drag and pinch.
 */
export type GestureContext = 'dashboard' | 'page' | 'fullscreen' | 'off';

/** Never start a gesture from these: typing, sliders, opt-outs. */
const BLOCK = 'input, textarea, select, [contenteditable="true"], [data-no-gesture], [role="dialog"]';
/** Controls with their own tap / long press (buttons, the orb…). */
const PRESSABLE = 'button, a, label, summary, [role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="tab"], .hd-orb';

function inHorizontalScroller(el: Element | null, stop: Element): boolean {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function allowFor(target: Element | null, root: Element, ctx: GestureContext): Allow {
  if (!target || ctx === 'off' || target.closest(BLOCK)) return ALLOW_NONE;
  if (ctx === 'fullscreen') return { ...ALLOW_NONE, pinch: true };
  if (target.closest('canvas') && !target.closest('.hd')) return ALLOW_NONE;
  const horizontal = !inHorizontalScroller(target, root);
  if (ctx === 'page') return { ...ALLOW_NONE, horizontal };
  return { press: !target.closest(PRESSABLE), horizontal, vertical: true, pinch: true };
}

/**
 * Attach touchscreen gestures to `ref`. `onGesture` returns true when it did
 * something; the click that the same finger would otherwise produce on a
 * button underneath is then swallowed.
 */
export function useTouchGestures(ref: RefObject<HTMLElement | null>, ctx: GestureContext, onGesture: (g: GestureName) => boolean) {
  const enabled = useGestures((s) => s.enabled);
  const handler = useRef(onGesture);
  handler.current = onGesture;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let swallowUntil = 0;
    const rec = createGestureRecognizer(
      () => ({ ...DEFAULT_RECOGNIZER, ...useGestures.getState().tuning, viewportHeight: window.innerHeight }),
      (g) => {
        if (handler.current(g)) swallowUntil = performance.now() + 450;
      },
    );
    const opts = { passive: true } as const;
    const down = (e: PointerEvent) => {
      // Only the click from the gesture's own finger is swallowed; a new
      // touch is a new, deliberate tap.
      swallowUntil = 0;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      rec.down(e.pointerId, e.clientX, e.clientY, e.timeStamp, allowFor(e.target as Element, root, ctxRef.current));
    };
    const move = (e: PointerEvent) => rec.move(e.pointerId, e.clientX, e.clientY);
    const up = (e: PointerEvent) => rec.up(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    const cancel = (e: PointerEvent) => rec.cancel(e.pointerId);
    const click = (e: MouseEvent) => {
      if (performance.now() < swallowUntil) {
        e.preventDefault();
        e.stopPropagation();
        swallowUntil = 0;
      }
    };
    root.addEventListener('pointerdown', down, opts);
    root.addEventListener('pointermove', move, opts);
    root.addEventListener('pointerup', up, opts);
    root.addEventListener('pointercancel', cancel, opts);
    root.addEventListener('click', click, true);
    return () => {
      rec.dispose();
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('click', click, true);
    };
  }, [ref, enabled]);
}

/**
 * Tap / double-tap / long-press recognition for a single pointer.
 *
 * A single tap is reported only after the double-tap window closes, so a
 * double tap never also fires a tap. Movement beyond `moveTolerance` cancels
 * everything: that is a swipe or scroll, not a press.
 */
export interface PressHandlers {
  onTap?: () => void;
  onDoubleTap?: () => void;
  onLongPress?: () => void;
}

export interface PressOptions {
  doubleTapMs?: number;
  longPressMs?: number;
  moveTolerance?: number;
}

export interface PressRecognizer {
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(): void;
  cancel(): void;
  dispose(): void;
}

export function createPressRecognizer(handlers: () => PressHandlers, opts: PressOptions = {}): PressRecognizer {
  const doubleTapMs = opts.doubleTapMs ?? 280;
  const longPressMs = opts.longPressMs ?? 550;
  const tolerance = opts.moveTolerance ?? 12;

  let startX = 0;
  let startY = 0;
  let pressing = false;
  let longFired = false;
  let longTimer: ReturnType<typeof setTimeout> | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTap = false;

  const clearLong = () => {
    if (longTimer) clearTimeout(longTimer);
    longTimer = null;
  };
  const clearTap = () => {
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = null;
    pendingTap = false;
  };

  return {
    down(x, y) {
      pressing = true;
      longFired = false;
      startX = x;
      startY = y;
      clearLong();
      longTimer = setTimeout(() => {
        longTimer = null;
        if (!pressing) return;
        longFired = true;
        clearTap();
        handlers().onLongPress?.();
      }, longPressMs);
    },
    move(x, y) {
      if (!pressing) return;
      if (Math.hypot(x - startX, y - startY) > tolerance) {
        pressing = false;
        clearLong();
      }
    },
    up() {
      if (!pressing) return;
      pressing = false;
      clearLong();
      if (longFired) return;
      if (pendingTap) {
        clearTap();
        handlers().onDoubleTap?.();
        return;
      }
      const h = handlers();
      if (!h.onDoubleTap) {
        h.onTap?.();
        return;
      }
      pendingTap = true;
      tapTimer = setTimeout(() => {
        tapTimer = null;
        pendingTap = false;
        handlers().onTap?.();
      }, doubleTapMs);
    },
    cancel() {
      pressing = false;
      clearLong();
    },
    dispose() {
      pressing = false;
      clearLong();
      clearTap();
    },
  };
}

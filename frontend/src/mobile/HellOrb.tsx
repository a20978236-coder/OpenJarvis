import { useEffect, useId, useRef, useState } from 'react';
import { CanvasOrb } from './CanvasOrb';
import { ORB_CAPTIONS, type OrbState } from './orb-types';
import { useOrbPrefs } from './orb-prefs';
import { createPressRecognizer, type PressHandlers } from './press-recognizer';
import type { OrbEngine } from './particle-orb-engine';

interface HellOrbProps extends PressHandlers {
  state: OrbState;
  size?: number;
  /** Accessible name; defaults to the state's caption. */
  label?: string;
  showCaption?: boolean;
  caption?: string;
  /** Projector glow beneath the orb (main dashboard). */
  showBase?: boolean;
  /** Live speech level 0–1, or null for the built-in envelope. */
  level?: number | null;
  /** Polled every frame for a live level (no re-render); wins over `level`. */
  levelSource?: () => number | null;
  disabled?: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The HELL particle orb. Renders the 3D engine (lazy-loaded so first paint is
 * instant) and falls back to the 2D canvas orb when WebGL is unavailable or
 * the context is lost. Rendering pauses while the page is hidden or the orb
 * is scrolled out of view.
 */
export function HellOrb({
  state,
  size = 240,
  label,
  showCaption = true,
  caption,
  showBase = false,
  level = null,
  levelSource,
  disabled,
  onTap,
  onDoubleTap,
  onLongPress,
}: HellOrbProps) {
  const prefs = useOrbPrefs();
  const hintId = useId();
  const px = Math.round(size * prefs.scale);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<OrbEngine | null>(null);
  const [mode, setMode] = useState<'loading' | '3d' | 'fallback'>('loading');
  const stateRef = useRef(state);
  stateRef.current = state;

  // Create the engine once per size/base change; everything else is pushed in.
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void import('./particle-orb-engine')
      .then(({ createOrbEngine, webglAvailable }) => {
        if (cancelled) return;
        if (!webglAvailable()) {
          setMode('fallback');
          return;
        }
        engineRef.current = createOrbEngine(canvas, {
          size: px,
          prefs: useOrbPrefs.getState(),
          state: stateRef.current,
          animate: !prefersReducedMotion(),
          showBase,
          onContextLost: () => {
            engineRef.current?.dispose();
            engineRef.current = null;
            setMode('fallback');
          },
        });
        setMode('3d');
      })
      .catch(() => {
        if (!cancelled) setMode('fallback');
      });
    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // Size changes are applied without a rebuild below.
  }, [showBase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => engineRef.current?.setState(state), [state, mode]);
  useEffect(() => engineRef.current?.setLevel(level), [level, mode]);
  // Live level (voice-reactive particles) without re-rendering React 60x/s.
  const sourceRef = useRef(levelSource);
  sourceRef.current = levelSource;
  const hasSource = !!levelSource;
  useEffect(() => {
    if (!hasSource || mode !== '3d') return;
    let raf = 0;
    const tick = () => {
      engineRef.current?.setLevel(sourceRef.current?.() ?? null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasSource, mode]);
  useEffect(() => engineRef.current?.setSize(px), [px, mode]);
  useEffect(() => {
    const { palette, density, scale, speed, glow, reducedEffects } = prefs;
    engineRef.current?.setPrefs({ palette, density, scale, speed, glow, reducedEffects });
  }, [prefs, mode]);

  // Pause when hidden or off-screen (battery).
  useEffect(() => {
    const el = wrapRef.current;
    let visible = true;
    const apply = () => engineRef.current?.setPaused(document.hidden || !visible);
    const onVis = () => apply();
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        apply();
      });
      io.observe(el);
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, [mode]);

  // Gestures.
  const handlersRef = useRef<PressHandlers>({});
  handlersRef.current = disabled ? {} : { onTap, onDoubleTap, onLongPress };
  const recognizer = useRef(createPressRecognizer(() => handlersRef.current));
  useEffect(() => () => recognizer.current.dispose(), []);

  const interactive = Boolean(onTap || onDoubleTap || onLongPress);
  const text = caption ?? ORB_CAPTIONS[state];
  const hints = [
    onTap && 'tap to activate',
    onDoubleTap && 'double-tap to talk',
    onLongPress && 'long-press to customize',
  ].filter(Boolean).join(', ');

  const visual = (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ width: px, height: px, display: mode === 'fallback' ? 'none' : 'block', position: 'absolute', inset: 0 }}
      />
      {mode !== '3d' && (
        <div style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          <CanvasOrb state={state} size={px} showCaption={false} />
        </div>
      )}
    </>
  );

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {interactive ? (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-label={label ?? `HELL orb: ${text}`}
          aria-describedby={hints ? hintId : undefined}
          className="jm-orb hell-orb"
          data-mode={mode}
          style={{ width: px, height: px, touchAction: 'manipulation' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            recognizer.current.down(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => recognizer.current.move(e.clientX, e.clientY)}
          onPointerUp={() => recognizer.current.up()}
          onPointerCancel={() => recognizer.current.cancel()}
          onPointerLeave={() => recognizer.current.cancel()}
          onContextMenu={(e) => {
            // Right-click / iOS callout: treat as long press, never show a menu.
            e.preventDefault();
            if (!disabled) onLongPress?.();
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              // Keyboard users get the primary action directly (no double-tap wait).
              (onDoubleTap ?? onTap)?.();
            }
          }}
        >
          {visual}
          {hints && (
            <span id={hintId} className="sr-only">
              {hints}
            </span>
          )}
        </div>
      ) : (
        <div className="jm-orb hell-orb" data-mode={mode} style={{ width: px, height: px, cursor: 'default' }} role="img" aria-label={label ?? `HELL: ${text}`}>
          {visual}
        </div>
      )}
      {showCaption && (
        <div className="jm-orb-caption" aria-live="polite">
          {text}
        </div>
      )}
    </div>
  );
}

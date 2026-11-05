import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, Hand } from 'lucide-react';
import { createGestureRecognizer, DEFAULT_RECOGNIZER, GESTURE_NAMES, type GestureName } from './gesture-recognizer';
import { ACTION_LABELS, GESTURE_LABELS, useGestures } from './gesture-settings';
import './gestures.css';

/** Where each default action can run. */
const WHERE: Record<string, string> = {
  'prev-module': 'Dashboard and module screens',
  'next-module': 'Dashboard and module screens',
  'collapse-holo': 'Dashboard, and the full-screen hologram',
};

/**
 * Touchscreen gestures: what each one does, an on/off switch, and a pad to
 * try them. The pad only shows what was recognised; it never runs actions.
 */
export function GesturesScreen() {
  const navigate = useNavigate();
  const enabled = useGestures((s) => s.enabled);
  const feedback = useGestures((s) => s.feedback);
  const map = useGestures((s) => s.map);
  const update = useGestures((s) => s.update);
  const pad = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<{ g: GestureName; n: number } | null>(null);

  useEffect(() => {
    const el = pad.current;
    if (!el) return;
    let n = 0;
    const rec = createGestureRecognizer(
      () => ({ ...DEFAULT_RECOGNIZER, ...useGestures.getState().tuning, edgeGuard: 0, viewportHeight: window.innerHeight }),
      (g) => setSeen({ g, n: ++n }),
    );
    const all = { press: true, horizontal: true, vertical: true, pinch: true };
    const down = (e: PointerEvent) => rec.down(e.pointerId, e.clientX, e.clientY, e.timeStamp, all);
    const move = (e: PointerEvent) => rec.move(e.pointerId, e.clientX, e.clientY);
    const up = (e: PointerEvent) => rec.up(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    const cancel = (e: PointerEvent) => rec.cancel(e.pointerId);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      rec.dispose();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, []);

  return (
    <div className="jm-scroll ges">
      <button type="button" onClick={() => navigate('/m')} className="jm-icon-btn ges-back">
        <ChevronLeft size={20} aria-hidden="true" /> HELL
      </button>
      <header className="ges-head">
        <Hand size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Gestures</h1>
      </header>
      <p className="ges-lead">Shortcuts for the touchscreen. Every gesture also has a normal button, so you never need them.</p>

      <section className="jm-panel ges-card">
        <label className="holo-toggle">
          <input type="checkbox" className="hell-switch" checked={enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          <span>Touch gestures</span>
        </label>
        <label className="holo-toggle">
          <input type="checkbox" className="hell-switch" checked={feedback} disabled={!enabled} onChange={(e) => update({ feedback: e.target.checked })} />
          <span>Show what HELL recognised</span>
        </label>
      </section>

      <section aria-labelledby="ges-try">
        <h2 id="ges-try" className="jm-label">Try a gesture</h2>
        <div
          ref={pad}
          className="ges-pad"
          data-no-gesture
          role="img"
          aria-label={seen ? `Recognised: ${GESTURE_LABELS[seen.g]}` : 'Gesture test area'}
        >
          {seen ? (
            <p key={seen.n} className="ges-seen">
              <b>{GESTURE_LABELS[seen.g]}</b>
              <span>{ACTION_LABELS[map[seen.g]]}</span>
            </p>
          ) : (
            <p className="ges-hint">Swipe, pinch, double tap or long press here. Nothing runs; this pad only shows what was recognised.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="ges-list">
        <h2 id="ges-list" className="jm-label">What they do</h2>
        <ul className="ges-list">
          {GESTURE_NAMES.map((g) => (
            <li key={g} className="ges-row">
              <span className="ges-g">{GESTURE_LABELS[g]}</span>
              <span className="ges-a">
                {ACTION_LABELS[map[g]]}
                <small>{WHERE[map[g]] ?? 'Dashboard'}</small>
              </span>
            </li>
          ))}
        </ul>
        <p className="ges-note">
          Swipes are ignored when they start at the very top or bottom of the screen (iOS uses those), inside text boxes and sliders, or when they are slow or diagonal.
          Long press on the orb still opens orb settings; long press elsewhere on the dashboard opens Settings.
        </p>
        <p className="ges-note">Sensitivity, left-handed mode and your own assignments arrive with Calibration (Stage F). Camera hand gestures arrive in Stage G.</p>
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, Hand } from 'lucide-react';
import { createGestureRecognizer, DEFAULT_RECOGNIZER, GESTURE_NAMES, type GestureName } from './gesture-recognizer';
import { ACTION_LABELS, effectiveAction, GESTURE_LABELS, useGestures } from './gesture-settings';
import { HAND_ACTIONS, HAND_GESTURES, HAND_LABELS } from '../hands/hand-logic';
import { HAND_LIMITS, useHands } from '../hands/hand-store';
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
  const hand = useGestures((s) => s.hand);
  const act = (g: GestureName) => effectiveAction({ map, hand }, g);
  const update = useGestures((s) => s.update);
  const hands = useHands((s) => s.settings);
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
              <span>{ACTION_LABELS[act(seen.g)]}</span>
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
                {ACTION_LABELS[act(g)]}
                <small>{WHERE[act(g)] ?? 'Dashboard'}</small>
              </span>
            </li>
          ))}
        </ul>
        <p className="ges-note">
          Swipes are ignored when they start at the very top or bottom of the screen (iOS uses those), inside text boxes and sliders, or when they are slow or diagonal.
          Long press on the orb still opens orb settings; long press elsewhere on the dashboard opens Settings.
        </p>
        <p className="ges-note">
          {hand === 'left' ? 'Left-handed mode is on (swipe left and right are swapped). ' : ''}Change sensitivity, handedness and what each gesture does in{' '}
          <button type="button" className="ges-link" onClick={() => navigate('/m/calibration')}>Calibration</button>.
        </p>
      </section>

      <section className="jm-panel ges-card cal-section" aria-labelledby="ges-hands">
        <h2 id="ges-hands" className="cal-h">Camera hand gestures</h2>
        <p className="cal-p">
          Separate from touch: the front camera watches for a held hand sign. It runs only on this iPhone — no video leaves it — and only while you have it on.
          It turns off when you leave the dashboard, lock the phone, or show no hand for {hands.idleOffSec} seconds.
        </p>
        <ul className="ges-list">
          {HAND_GESTURES.map((g) => (
            <li key={g} className="ges-row">
              <span className="ges-g">{HAND_LABELS[g]}</span>
              <span className="ges-a">{HAND_ACTIONS[g]}</span>
            </li>
          ))}
        </ul>
        <label className="cal-knob">
          <span className="cal-knob-top">
            <span>Hold time</span>
            <output>{(hands.holdMs / 1000).toFixed(1)} s</output>
          </span>
          <input type="range" min={HAND_LIMITS.holdMs[0]} max={HAND_LIMITS.holdMs[1]} step={100} value={hands.holdMs} onChange={(e) => useHands.getState().updateSettings({ holdMs: Number(e.target.value) })} />
          <small>How long to hold a sign before HELL acts. Longer means fewer accidents.</small>
        </label>
        <label className="cal-knob">
          <span className="cal-knob-top">
            <span>Recognition confidence</span>
            <output>{Math.round(hands.minScore * 100)}%</output>
          </span>
          <input type="range" min={HAND_LIMITS.minScore[0]} max={HAND_LIMITS.minScore[1]} step={0.05} value={hands.minScore} onChange={(e) => useHands.getState().updateSettings({ minScore: Number(Number(e.target.value).toFixed(2)) })} />
          <small>Higher ignores unclear signs; lower reacts in poor light.</small>
        </label>
        <button
          type="button"
          className="jm-primary-btn"
          onClick={() => {
            useHands.getState().setWanted(true);
            navigate('/m');
          }}
        >
          <Hand size={18} aria-hidden="true" /> Turn on hand gestures
        </button>
        <p className="ges-note">Or tap “Hands” at the top right of the dashboard. The first time, the iPhone asks for camera permission.</p>
      </section>
    </div>
  );
}

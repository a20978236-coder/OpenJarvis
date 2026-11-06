import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, Crosshair, Hand, MousePointerClick, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { createGestureRecognizer, DEFAULT_RECOGNIZER, GESTURE_NAMES, type GestureName, type Observation } from './gesture-recognizer';
import {
  ACTION_LABELS,
  DEFAULT_SETTINGS,
  effectiveAction,
  GESTURE_LABELS,
  TUNING_LIMITS,
  useGestures,
  type GestureAction,
  type GestureSettings,
  type Tuning,
} from './gesture-settings';
import { checkSwipeSample, suggestTuning, TRAINING_STEPS, type SwipeSample, type TrainGesture } from './calibration';
import './gestures.css';

type Draft = Pick<GestureSettings, 'tuning' | 'map' | 'hand' | 'feedback'>;
const ACTIONS = Object.keys(ACTION_LABELS) as GestureAction[];
const pick = (s: GestureSettings): Draft => ({ tuning: { ...s.tuning }, map: { ...s.map }, hand: s.hand, feedback: s.feedback });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/** One tunable: what it means in plain words and how to show its value. */
const KNOBS: { key: keyof Tuning; label: string; help: string; step: number; show: (v: number) => string; invert?: boolean }[] = [
  { key: 'swipeDistance', label: 'Gesture distance', help: 'How far a finger must travel for a swipe.', step: 5, show: (v) => `${v} px` },
  { key: 'minVelocity', label: 'Swipe sensitivity', help: 'Higher lets slower, gentler swipes count.', step: 0.05, invert: true, show: (v) => `${v <= 0.2 ? 'High' : v <= 0.4 ? 'Medium' : 'Low'} · ${v.toFixed(2)} px/ms` },
  { key: 'dominance', label: 'Direction strictness', help: 'Higher ignores more diagonal or curved swipes.', step: 0.1, show: (v) => `${v.toFixed(1)}×` },
  { key: 'swipeMaxMs', label: 'Slowest swipe', help: 'Longer than this is a drag, not a swipe.', step: 50, show: (v) => `${v} ms` },
  { key: 'doubleTapMs', label: 'Double-tap speed', help: 'Longest pause allowed between the two taps.', step: 10, show: (v) => `${v} ms` },
  { key: 'longPressMs', label: 'Long-press time', help: 'How long to hold before it counts.', step: 50, show: (v) => `${(v / 1000).toFixed(2)} s` },
  { key: 'pinchRatio', label: 'Pinch strength', help: 'How much the fingers must spread or close.', step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
];

const STEP_ICON: Record<TrainGesture, typeof ArrowLeft> = {
  'swipe-left': ArrowLeft,
  'swipe-right': ArrowRight,
  'swipe-up': ArrowUp,
  'swipe-down': ArrowDown,
  'double-tap': MousePointerClick,
};

/**
 * Gesture calibration: guided training, fine-tuning, handedness, custom
 * assignments and a live test pad. Changes are a draft until saved.
 */
export function CalibrationScreen() {
  const navigate = useNavigate();
  const saved = useGestures();
  const [draft, setDraft] = useState<Draft>(() => pick(useGestures.getState()));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirty = !same(draft, pick(saved));
  const [confirmReset, setConfirmReset] = useState(false);
  const [training, setTraining] = useState(false);
  const [suggestion, setSuggestion] = useState<Tuning | null>(null);

  const setTuning = (k: keyof Tuning, v: number) => setDraft((d) => ({ ...d, tuning: { ...d.tuning, [k]: Number(v.toFixed(3)) } }));

  const save = () => {
    saved.update(draft);
    setDraft(pick(useGestures.getState()));
    toast.success('Calibration saved on this iPhone');
  };
  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    saved.reset();
    setDraft(pick(useGestures.getState()));
    setConfirmReset(false);
    setSuggestion(null);
    toast('Calibration reset to defaults');
  };
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  const back = () => {
    if (dirty && !window.confirm('Leave without saving your calibration?')) return;
    navigate('/m');
  };

  return (
    <div className="jm-scroll ges cal">
      <button type="button" onClick={back} className="jm-icon-btn ges-back">
        <ChevronLeft size={20} aria-hidden="true" /> HELL
      </button>
      <header className="ges-head">
        <Crosshair size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Calibration</h1>
      </header>
      <p className="ges-lead">Teach HELL how you swipe, then fine-tune and test. Nothing changes until you tap Save. Settings are kept on this iPhone.</p>

      {/* ---- Guided training ------------------------------------------- */}
      <section className="jm-panel ges-card cal-section" aria-labelledby="cal-train">
        <h2 id="cal-train" className="cal-h">Gesture training</h2>
        {training ? (
          <Trainer
            tuning={draft.tuning}
            onDone={(t) => {
              setTraining(false);
              setSuggestion(t);
            }}
            onCancel={() => setTraining(false)}
          />
        ) : suggestion ? (
          <Suggestion
            current={draft.tuning}
            next={suggestion}
            onUse={() => {
              setDraft((d) => ({ ...d, tuning: suggestion }));
              setSuggestion(null);
              toast('Applied — test below, then Save');
            }}
            onDiscard={() => setSuggestion(null)}
          />
        ) : (
          <>
            <p className="cal-p">Swipe in each direction twice and double tap twice (about 30 seconds). HELL suggests settings that fit your hand, with a margin so slips don't trigger anything.</p>
            <button type="button" className="jm-primary-btn" onClick={() => setTraining(true)}>
              <Hand size={18} aria-hidden="true" /> Start training
            </button>
          </>
        )}
      </section>

      {/* ---- Live test ----------------------------------------------------- */}
      <section className="cal-section" aria-labelledby="cal-test">
        <h2 id="cal-test" className="jm-label">Live test (uses your unsaved settings)</h2>
        <LivePad draft={draft} />
      </section>

      {/* ---- Handedness ---------------------------------------------------- */}
      <section className="jm-panel ges-card cal-section" aria-labelledby="cal-hand">
        <h2 id="cal-hand" className="cal-h">Hand</h2>
        <div role="radiogroup" aria-labelledby="cal-hand" className="cal-choices">
          {(['right', 'left'] as const).map((h) => (
            <button key={h} type="button" role="radio" aria-checked={draft.hand === h} className="jm-icon-btn hell-choice" onClick={() => setDraft((d) => ({ ...d, hand: h }))}>
              {h === 'right' ? 'Right-handed' : 'Left-handed'}
            </button>
          ))}
        </div>
        <p className="cal-p">Left-handed mode swaps what swipe left and swipe right do.</p>
      </section>

      {/* ---- Fine tuning ----------------------------------------------- */}
      <section className="jm-panel ges-card cal-section" aria-labelledby="cal-tune">
        <h2 id="cal-tune" className="cal-h">Sensitivity and speed</h2>
        {KNOBS.map((k) => {
          const [lo, hi] = TUNING_LIMITS[k.key];
          const v = draft.tuning[k.key];
          // Sensitivity reads better as "higher = more sensitive".
          const pos = k.invert ? lo + hi - v : v;
          return (
            <label key={k.key} className="cal-knob">
              <span className="cal-knob-top">
                <span>{k.label}</span>
                <output>{k.show(v)}</output>
              </span>
              <input
                type="range"
                aria-label={k.label}
                aria-valuetext={k.show(v)}
                min={lo}
                max={hi}
                step={k.step}
                value={pos}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const val = k.invert ? lo + hi - raw : raw;
                  setTuning(k.key, Math.round(val / k.step) * k.step);
                }}
              />
              <small>{k.help}</small>
            </label>
          );
        })}
      </section>

      {/* ---- Feedback ---------------------------------------------------- */}
      <section className="jm-panel ges-card cal-section" aria-labelledby="cal-fb">
        <h2 id="cal-fb" className="cal-h">Recognition feedback</h2>
        <label className="holo-toggle">
          <input type="checkbox" className="hell-switch" checked={draft.feedback} onChange={(e) => setDraft((d) => ({ ...d, feedback: e.target.checked }))} />
          <span>Show a label when a gesture is recognised</span>
        </label>
      </section>

      {/* ---- Assignments ------------------------------------------------- */}
      <section className="jm-panel ges-card cal-section" aria-labelledby="cal-map">
        <h2 id="cal-map" className="cal-h">What each gesture does</h2>
        {GESTURE_NAMES.map((g) => (
          <label key={g} className="cal-assign">
            <span>{GESTURE_LABELS[g]}</span>
            <select className="jm-field" value={draft.map[g]} onChange={(e) => setDraft((d) => ({ ...d, map: { ...d.map, [g]: e.target.value as GestureAction } }))}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{ACTION_LABELS[a]}</option>
              ))}
            </select>
          </label>
        ))}
        <button type="button" className="jm-icon-btn cal-wide" onClick={() => setDraft((d) => ({ ...d, map: { ...DEFAULT_SETTINGS.map } }))}>
          Use the standard assignments
        </button>
        <p className="cal-p">Module screens only use swipe left/right for moving between modules; other actions work on the dashboard.</p>
      </section>

      {/* ---- Save / reset ------------------------------------------------ */}
      <div className="cal-bar" data-dirty={dirty || undefined}>
        <span role="status" aria-live="polite" className="cal-status">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <button type="button" className="jm-icon-btn cal-reset" onClick={reset} aria-label={confirmReset ? 'Tap again to reset calibration' : 'Reset calibration'}>
          <RotateCcw size={16} aria-hidden="true" /> {confirmReset ? 'Tap again' : 'Reset'}
        </button>
        <button type="button" className="jm-primary-btn" onClick={save} disabled={!dirty}>
          <Save size={16} aria-hidden="true" /> Save
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Trainer({ tuning, onDone, onCancel }: { tuning: Tuning; onDone: (t: Tuning) => void; onCancel: () => void }) {
  const pad = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState('');
  const swipes = useRef<SwipeSample[]>([]);
  const gaps = useRef<number[]>([]);
  const stepRef = useRef(0);
  stepRef.current = step;
  // Latest props without re-attaching listeners (that would lose a pending tap).
  const props = useRef({ tuning, onDone });
  props.current = { tuning, onDone };
  const want = TRAINING_STEPS[step];

  useEffect(() => {
    const el = pad.current;
    if (!el) return;
    let start: { id: number; x: number; y: number; t: number } | null = null;
    let extra = false;
    let lastTapUp: number | null = null;
    const advance = (text: string) => {
      setMsg(text);
      const next = stepRef.current + 1;
      if (next >= TRAINING_STEPS.length) props.current.onDone(suggestTuning(swipes.current, gaps.current, props.current.tuning));
      else setStep(next);
    };
    const down = (e: PointerEvent) => {
      if (start) {
        extra = true;
        return;
      }
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
      extra = false;
      const w = TRAINING_STEPS[stepRef.current];
      if (w === 'double-tap' && lastTapUp !== null) {
        const gap = e.timeStamp - lastTapUp;
        lastTapUp = null;
        if (gap <= 1000) {
          gaps.current.push(gap);
          // Register on the second touch-down, like the recogniser.
          advance(`Got it — ${Math.round(gap)} ms between taps.`);
          start = null;
          return;
        }
      }
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const s = start;
      start = null;
      if (extra) {
        setMsg('Use one finger for this step.');
        return;
      }
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      const ms = e.timeStamp - s.t;
      const w = TRAINING_STEPS[stepRef.current];
      if (w === 'double-tap') {
        if (Math.hypot(dx, dy) > 14 || ms > 400) {
          setMsg('Tap — don\'t drag or hold.');
          lastTapUp = null;
          return;
        }
        lastTapUp = e.timeStamp;
        return;
      }
      const check = checkSwipeSample(w, dx, dy);
      if (!check.ok) {
        setMsg(check.reason);
        return;
      }
      swipes.current.push({ want: w, dx, dy, ms });
      advance(`Got it — ${Math.round(Math.max(Math.abs(dx), Math.abs(dy)))} px in ${Math.round(ms)} ms.`);
    };
    const cancel = () => {
      start = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, []);

  const Icon = STEP_ICON[want];
  const say = want === 'double-tap' ? 'Double tap' : GESTURE_LABELS[want];
  return (
    <div className="cal-train">
      <p className="cal-step" aria-live="polite">
        <b>{say}</b> in the box · step {step + 1} of {TRAINING_STEPS.length}
      </p>
      <div ref={pad} className="ges-pad cal-pad" data-no-gesture data-want={want} role="img" aria-label={`Training area: ${say}`}>
        <Icon key={step} className="cal-arrow" size={56} strokeWidth={1.5} aria-hidden="true" data-dir={want} />
      </div>
      <div className="cal-dots" aria-hidden="true">
        {TRAINING_STEPS.map((_, i) => (
          <span key={i} data-done={i < step || undefined} data-now={i === step || undefined} />
        ))}
      </div>
      <p className="cal-msg" role="status" aria-live="polite">{msg || 'Swipe the way you normally would.'}</p>
      <button type="button" className="jm-icon-btn cal-wide" onClick={onCancel}>Cancel training</button>
    </div>
  );
}

function Suggestion({ current, next, onUse, onDiscard }: { current: Tuning; next: Tuning; onUse: () => void; onDiscard: () => void }) {
  return (
    <div className="cal-suggest">
      <p className="cal-p">
        <Check size={16} aria-hidden="true" /> Done. Suggested settings for your hand:
      </p>
      <table className="cal-table">
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Now</th>
            <th scope="col">Suggested</th>
          </tr>
        </thead>
        <tbody>
          {KNOBS.filter((k) => k.key !== 'longPressMs' && k.key !== 'pinchRatio').map((k) => (
            <tr key={k.key} data-changed={current[k.key] !== next[k.key] || undefined}>
              <th scope="row">{k.label}</th>
              <td>{k.show(current[k.key])}</td>
              <td>{k.show(next[k.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-row">
        <button type="button" className="jm-primary-btn" onClick={onUse}>Use these</button>
        <button type="button" className="jm-icon-btn cal-wide" onClick={onDiscard}>Keep mine</button>
      </div>
    </div>
  );
}

function LivePad({ draft }: { draft: Draft }) {
  const pad = useRef<HTMLDivElement>(null);
  const live = useRef(draft);
  live.current = draft;
  const [seen, setSeen] = useState<{ g: GestureName | null; text: string; n: number } | null>(null);

  useEffect(() => {
    const el = pad.current;
    if (!el) return;
    let n = 0;
    const all = { press: true, horizontal: true, vertical: true, pinch: true };
    const rec = createGestureRecognizer(
      () => ({ ...DEFAULT_RECOGNIZER, ...live.current.tuning, edgeGuard: 0, viewportHeight: window.innerHeight }),
      (g) => {
        if (g === 'long-press') setSeen({ g, text: '', n: ++n });
      },
      undefined,
      (o: Observation) => {
        if (o.kind === 'swipe') {
          setSeen({ g: o.gesture, text: o.gesture ? `${o.distance} px in ${o.ms} ms` : o.reason, n: ++n });
        } else if (o.kind === 'tap') {
          if (o.gesture) setSeen({ g: o.gesture, text: `${Math.round(o.gapMs ?? 0)} ms between taps`, n: ++n });
          else if (o.gapMs !== null) setSeen({ g: null, text: `taps ${Math.round(o.gapMs)} ms apart, limit ${live.current.tuning.doubleTapMs} ms`, n: ++n });
        } else {
          setSeen({ g: o.gesture, text: o.gesture ? `${Math.round(Math.abs(o.ratio - 1) * 100)}% spread` : o.reason, n: ++n });
        }
      },
    );
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
    <div ref={pad} className="ges-pad" data-no-gesture role="img" aria-label={seen ? (seen.g ? `Recognised: ${GESTURE_LABELS[seen.g]}` : `Not a gesture: ${seen.text}`) : 'Gesture test area'}>
      {seen ? (
        <p key={seen.n} className="ges-seen" data-miss={!seen.g || undefined}>
          <b>{seen.g ? GESTURE_LABELS[seen.g] : 'Not a gesture'}</b>
          <span>{seen.g ? ACTION_LABELS[effectiveAction(draft, seen.g)] : ''}</span>
          <span className="cal-why">{seen.text}</span>
        </p>
      ) : (
        <p className="ges-hint">Try any gesture. HELL shows what it recognised — or why not — using the settings below, before you save.</p>
      )}
    </div>
  );
}

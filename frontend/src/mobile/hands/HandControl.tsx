import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Hand, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTtsStore } from '../../lib/tts';
import { useMobile } from '../MobileShell';
import { useCamera, type Facing } from '../vision/camera';
import { createStabilizer, DEFAULT_STABILIZER, HAND_LABELS, toHandGesture, type HandGesture } from './hand-logic';
import { useHands } from './hand-store';
import { loadRecognizer, runRecognizer } from './hand-tracker';
import './hands.css';

/**
 * Camera hand gestures on the dashboard. Shown (and the front camera on)
 * only while the user has turned it on; a small mirrored self-view makes
 * it obvious the camera is in use, with a big off button. Everything runs
 * on this phone; no frame is sent anywhere.
 */
export function HandControl() {
  const wanted = useHands((s) => s.wanted);
  if (!wanted) return null;
  return <HandSession />;
}

/** Live sessions; StrictMode (dev) mounts, unmounts and re-mounts once. */
let sessions = 0;

function HandSession() {
  const navigate = useNavigate();
  const m = useMobile();
  const mobile = useRef(m);
  mobile.current = m;
  const stream = useCamera((s) => s.stream);
  const camStatus = useCamera((s) => s.status);
  const camError = useCamera((s) => s.error);
  const status = useHands((s) => s.status);
  const error = useHands((s) => s.error);
  const seen = useHands((s) => s.seen);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const saidN = useRef(0);

  const off = (why?: string) => {
    useHands.getState().setWanted(false);
    if (why) toast(why);
  };

  // Start the front camera (low resolution) and load the model in parallel.
  useEffect(() => {
    sessions++;
    const prevFacing: Facing = useCamera.getState().facing;
    useHands.getState().setStatus('loading');
    void useCamera.getState().start('user', { width: 640, height: 480 });
    let live = true;
    loadRecognizer().catch((e: unknown) => {
      if (live) useHands.getState().setStatus('error', e instanceof Error ? e.message : 'Hand tracking could not start.');
    });
    return () => {
      live = false;
      sessions--;
      useCamera.getState().stop();
      useCamera.setState({ facing: prevFacing });
      // Leaving the dashboard ends hand gestures; a StrictMode re-mount doesn't.
      setTimeout(() => {
        if (sessions === 0) useHands.getState().setWanted(false);
      }, 0);
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== stream) v.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (camStatus === 'error') useHands.getState().setStatus('error', camError ?? 'The camera could not be started.');
  }, [camStatus, camError]);

  // Camera released elsewhere (app went to the background, another screen):
  // hand gestures are off too, never silently restarted.
  const camWasOn = useRef(false);
  useEffect(() => {
    if (camStatus === 'on') camWasOn.current = true;
    else if (camWasOn.current && camStatus === 'off') off('Hand gestures turned off (camera stopped)');
  }, [camStatus]);

  // Run the recogniser once both the camera and the model are ready.
  useEffect(() => {
    if (camStatus !== 'on' || !stream) return;
    const v = videoRef.current;
    if (!v) return;
    let stop: (() => void) | null = null;
    let live = true;
    const stab = createStabilizer(() => ({ ...DEFAULT_STABILIZER, holdMs: useHands.getState().settings.holdMs }));
    let lastHand = performance.now();
    loadRecognizer()
      .then((rec) => {
        if (!live) return;
        useHands.getState().setStatus('on');
        stop = runRecognizer(rec, v, (f) => {
          const { settings } = useHands.getState();
          if (f.handSeen) lastHand = f.t;
          else if (f.t - lastHand > settings.idleOffSec * 1000) {
            off(`Hand gestures turned off — no hand seen for ${settings.idleOffSec} s`);
            return;
          }
          const g = toHandGesture(f.category, f.score, settings.minScore);
          const r = stab.feed(g, f.t);
          useHands.getState().setSeen({ gesture: r.holding, progress: r.progress, handSeen: f.handSeen, raw: f.category ? { category: f.category, score: f.score } : undefined });
          if (r.fired) {
            const text = act(r.fired);
            setSaid({ text: `${HAND_LABELS[r.fired]} · ${text}`, n: ++saidN.current });
          }
        });
      })
      .catch(() => undefined); // status already set by the loader effect
    return () => {
      live = false;
      stop?.();
    };
  }, [camStatus, stream]);

  /** Do what a recognised gesture means; returns what happened, in words. */
  function act(g: HandGesture): string {
    const { speechState, speechAvailable, online, listen, toggleTalk, cancelListening, activate, flashError } = mobile.current;
    const tts = useTtsStore.getState();
    const recording = speechState === 'recording';
    const speaking = tts.state === 'speaking' || tts.state === 'loading';
    switch (g) {
      case 'open-palm':
        if (recording) return 'Already listening';
        activate();
        if (!speechAvailable || online === false) {
          flashError();
          return 'HELL is ready (voice is unavailable)';
        }
        void listen();
        return 'Listening';
      case 'fist':
        if (!recording && !speaking) return 'Paused (nothing was running)';
        tts.stop();
        if (recording) cancelListening();
        return 'Paused';
      case 'thumbs-up':
        if (recording) {
          void toggleTalk();
          return 'Sending what you said';
        }
        return 'Nothing to confirm';
      case 'thumbs-down':
        if (recording) {
          cancelListening();
          return 'Discarded — nothing was sent';
        }
        if (speaking) {
          tts.stop();
          return 'Stopped speaking';
        }
        return 'Nothing to cancel';
      case 'two-fingers':
        navigate('/m/vision');
        return 'Opening Vision';
    }
  }

  const ringStyle = { ['--p' as string]: `${Math.round(seen.progress * 100)}%` };
  const label =
    status === 'loading'
      ? 'Starting hand tracking…'
      : status === 'error'
        ? 'Hand gestures unavailable'
        : seen.gesture
          ? HAND_LABELS[seen.gesture]
          : seen.handSeen
            ? 'Hand seen'
            : 'Show a hand';

  return (
    <div className="hand-panel" role="region" aria-label="Camera hand gestures" data-status={status} data-raw={seen.raw ? `${seen.raw.category}:${seen.raw.score.toFixed(2)}` : undefined} data-no-gesture>
      <div className="hand-view" style={ringStyle} data-holding={seen.progress > 0 || undefined}>
        <video ref={videoRef} className="hand-video" playsInline muted autoPlay aria-label="Front camera, used for hand gestures on this phone only" />
        {status !== 'on' && <Hand className="hand-wait" size={26} aria-hidden="true" />}
      </div>
      <div className="hand-side">
        <p className="hand-label" aria-live="polite">{label}</p>
        {said && (
          <p key={said.n} className="hand-said" role="status">
            {said.text}
          </p>
        )}
        {status === 'error' && error && <p className="hand-error" role="alert">{error}</p>}
      </div>
      <button type="button" className="hand-off" onClick={() => off()} aria-label="Turn hand gestures off">
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Camera, CameraOff, ChevronLeft, Cpu, GitCompare, Send, SwitchCamera } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useTtsStore } from '../../lib/tts';
import { isEmbedOnlyModel } from '../../lib/model-capabilities';
import { DictateButton } from '../DictateButton';
import { HellOrb } from '../HellOrb';
import { useMobile } from '../MobileShell';
import { captureFrame, frameObjectUrl, useCamera } from './camera';
import { askVision, getVisionStatus, loadVisionModel, saveVisionModel, VISION_PROMPTS, type VisionStatus } from './vision-api';
import './vision.css';

interface Shot {
  id: number;
  /** blob: URL for the thumbnail (revoked when the shot leaves the log). */
  viewUrl: string;
  base64: string;
  question: string;
  answer: string;
  error?: string;
  compared?: boolean;
}

/**
 * Vision mode: live preview, then ONE frame is captured and sent to the
 * user's own server only when they ask a question. Nothing is recorded or
 * streamed; the camera stops when leaving this screen or the app.
 */
export function VisionScreen() {
  const navigate = useNavigate();
  const { online, flashError } = useMobile();
  const { stream, status, error, facing, analyzing, start, stop, flip, setAnalyzing } = useCamera();
  const models = useAppStore((s) => s.models);
  const chatModel = useAppStore((s) => s.selectedModel);
  const voiceOut = useAppStore((s) => s.settings.voiceOutputEnabled);
  const [model, setModel] = useState(() => loadVisionModel() || chatModel);
  const [vstatus, setVStatus] = useState<VisionStatus | null>(null);
  const [question, setQuestion] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [compare, setCompare] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  const shown = useRef<Shot[]>([]);
  shown.current = shots;

  // Camera off when leaving the screen (privacy + battery); free the photos.
  useEffect(() => () => {
    abort.current?.abort();
    useCamera.getState().stop();
    shown.current.forEach((s) => URL.revokeObjectURL(s.viewUrl));
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== stream) v.srcObject = stream;
  }, [stream]);

  // Is the chosen model able to see? Suggest one that can.
  useEffect(() => {
    if (!online || !model) return;
    let live = true;
    getVisionStatus(model)
      .then((s) => {
        if (!live) return;
        setVStatus(s);
        if (s.model_sees === false && s.vision_models.length && !loadVisionModel()) {
          setModel(s.vision_models[0]);
        }
      })
      .catch(() => live && setVStatus(null));
    return () => {
      live = false;
    };
  }, [model, online]);

  useEffect(() => {
    if (!model && chatModel) setModel(chatModel);
  }, [chatModel, model]);

  const chooseModel = (m: string) => {
    setModel(m);
    saveVisionModel(m);
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || analyzing) return;
    const v = videoRef.current;
    if (status !== 'on' || !v) return;
    const frame = captureFrame(v);
    if (!frame) return;
    const prev = shots[0];
    const usePrev = compare && prev ? prev : null;
    const shot: Shot = { id: Date.now(), viewUrl: frameObjectUrl(frame.base64), base64: frame.base64, question: text, answer: '', compared: !!usePrev };
    setShots((s) => {
      const next = [shot, ...s];
      next.slice(4).forEach((old) => URL.revokeObjectURL(old.viewUrl));
      return next.slice(0, 4);
    });
    setQuestion('');
    setAnalyzing(true);
    abort.current = new AbortController();
    try {
      const answer = await askVision({
        model,
        question: usePrev ? `${text} (Compare the earlier photo with the new one.)` : text,
        frames: usePrev ? [usePrev.base64, frame.base64] : [frame.base64],
        signal: abort.current.signal,
        onText: (t) => setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, answer: t } : x))),
      });
      setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, answer: answer || '(No answer.)' } : x)));
      if (voiceOut && answer) void useTtsStore.getState().speak(`vision-${shot.id}`, answer);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : 'Vision request failed';
      setShots((s) => s.map((x) => (x.id === shot.id ? { ...x, error: msg } : x)));
      flashError();
    } finally {
      setAnalyzing(false);
      abort.current = null;
    }
  };

  const chatModels = models.filter((m) => !isEmbedOnlyModel(m.id)).map((m) => m.id);
  const canSee = vstatus?.model_sees;
  const latest = shots[0];

  return (
    <div className="vis">
      <header className="vis-top">
        <button type="button" className="jm-icon-btn" onClick={() => navigate('/m')} aria-label="Back to HELL">
          <ChevronLeft size={22} />
        </button>
        <h1>Vision</h1>
        <HellOrb state={analyzing ? 'vision' : status === 'on' ? 'idle' : 'offline'} size={44} showCaption={false} label={analyzing ? 'HELL is looking' : 'HELL'} />
      </header>

      <div className="vis-view" data-analyzing={analyzing || undefined}>
        <video
          ref={videoRef}
          className="vis-video"
          data-mirror={facing === 'user' || undefined}
          playsInline
          muted
          autoPlay
          aria-label={status === 'on' ? `Live ${facing === 'user' ? 'front' : 'rear'} camera` : 'Camera off'}
          hidden={status !== 'on'}
        />
        {analyzing && latest && <img className="vis-frozen" src={latest.viewUrl} alt="The photo HELL is looking at" />}
        {analyzing && <div className="vis-scan" aria-hidden="true" />}
        {status !== 'on' && (
          <div className="vis-off">
            <CameraOff size={34} aria-hidden="true" />
            <p>{status === 'starting' ? 'Starting camera…' : error ?? 'Camera is off'}</p>
            <button type="button" className="jm-primary-btn" onClick={() => void start()} disabled={status === 'starting'}>
              <Camera size={18} aria-hidden="true" /> Turn camera on
            </button>
            <p className="vis-privacy">Nothing is recorded or streamed. When you ask, one photo goes to your own HELL server.</p>
          </div>
        )}
        {status === 'on' && (
          <div className="vis-cam-controls">
            <button type="button" className="vis-off-btn" onClick={stop} aria-label="Turn camera off">
              <CameraOff size={18} aria-hidden="true" /> Camera off
            </button>
            <button type="button" className="jm-icon-btn" onClick={() => void flip()} aria-label={`Switch to ${facing === 'user' ? 'rear' : 'front'} camera`}>
              <SwitchCamera size={20} />
            </button>
          </div>
        )}
      </div>

      <div className="vis-panel">
        {canSee === false && (
          <div className="vis-warn" role="alert">
            <Cpu size={16} aria-hidden="true" />
            <span>
              <b>{model || 'This model'}</b> can't see images.{' '}
              {vstatus?.vision_models.length ? 'Pick a vision model below.' : <>Install one on your server: <code>{vstatus?.hint}</code></>}
            </span>
          </div>
        )}
        <label className="vis-model">
          <span className="jm-label">Vision model</span>
          <select className="jm-field" value={model} onChange={(e) => chooseModel(e.target.value)}>
            {!chatModels.includes(model) && model && <option value={model}>{model}</option>}
            {chatModels.map((m) => (
              <option key={m} value={m}>
                {m}
                {vstatus?.vision_models.includes(m) ? ' · sees images' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="holo-chips" role="group" aria-label="Quick questions" tabIndex={0}>
          {VISION_PROMPTS.map((p) => (
            <button key={p} type="button" className="holo-chip" disabled={status !== 'on' || analyzing} onClick={() => void ask(p)}>
              {p}
            </button>
          ))}
        </div>

        <form
          className="vis-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <label className="sr-only" htmlFor="vis-question">Ask about what the camera sees</label>
          <input
            id="vis-question"
            className="jm-field"
            placeholder={status === 'on' ? 'Ask about what you see…' : 'Turn the camera on first'}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={status !== 'on'}
            enterKeyHint="send"
          />
          <DictateButton label="Ask by voice" onText={(t) => void ask(t)} />
          <button type="submit" className="jm-primary-btn" style={{ width: 44, padding: 0, flexShrink: 0 }} disabled={!question.trim() || status !== 'on' || analyzing} aria-label="Ask">
            <Send size={18} />
          </button>
        </form>
        <label className="holo-toggle" style={{ minHeight: 36, fontSize: 14 }}>
          <input type="checkbox" className="hell-switch" checked={compare} disabled={!shots.length} onChange={(e) => setCompare(e.target.checked)} />
          <GitCompare size={16} aria-hidden="true" /> Compare with the previous photo
        </label>

        <div role="log" aria-live="polite" className="vis-log">
          {shots.map((s) => (
            <article key={s.id} className="vis-entry" data-error={s.error ? true : undefined}>
              <img src={s.viewUrl} alt="" className="vis-thumb" />
              <div>
                <p className="vis-q">
                  {s.question}
                  {s.compared ? ' · compared' : ''}
                </p>
                <p className="vis-a" data-selectable>
                  {s.error ?? (s.answer || 'Looking…')}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

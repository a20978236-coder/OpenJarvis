import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Activity, Camera, ChevronDown, ChevronLeft, Copy, Gauge, Mic, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, fetchSpeechHealth, fetchTtsHealth } from '../../lib/api';
import { meterStream, resumeAudioContext } from '../../lib/audio-level';
import { deviceRecognitionSupported, deviceVoicesSupported } from '../../lib/device-speech';
import { useErrorLog } from '../../lib/error-log';
import { getMemorySettings } from '../../lib/memory-api';
import { useVoicePrefs } from '../../lib/voice-prefs';
import { useGestures } from '../gestures/gesture-settings';
import { handModelInstalled } from '../hands/hand-tracker';
import { useMobile } from '../MobileShell';
import {
  aiCheck,
  cameraCheck,
  errorsCheck,
  gestureCheck,
  internetCheck,
  memoryCheck,
  micCheck,
  renderCheck,
  reportText,
  voiceCheck,
  type CheckResult,
  type Status,
} from './checks';
import '../gestures/gestures.css';
import './diagnostics.css';

type Perm = 'granted' | 'denied' | 'prompt' | 'unknown';

async function permission(name: string): Promise<Perm> {
  try {
    const s = await navigator.permissions?.query({ name: name as PermissionName });
    return (s?.state as Perm) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

interface ServerDiag {
  hell?: string;
  ai: { engine: string; model: string; healthy: boolean; models: number; latency_ms: number | null; error?: string; configured?: boolean };
  internet: { ok: boolean; latency_ms?: number; error?: string };
  memory: { store: string; entries: number; learning: string; use_in_replies: boolean; learner_running: boolean; error?: string };
  voice: { stt: string; tts: string | null };
}

function measureFps(ms = 1500): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      frames++;
      if (t - t0 < ms) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (t - t0));
    };
    requestAnimationFrame(tick);
  });
}

function webglInfo(): { webgl: boolean; webgl2: boolean; renderer?: string } {
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    const gl = gl2 ?? c.getContext('webgl');
    if (!gl) return { webgl: false, webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : undefined;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl: true, webgl2: !!gl2, renderer };
  } catch {
    return { webgl: false, webgl2: false };
  }
}

const LABEL: Record<Status, string> = { ok: 'OK', warn: 'Check', bad: 'Problem', unknown: 'Not tested' };

function Row({ c, action }: { c: CheckResult; action?: React.ReactNode }) {
  const [open, setOpen] = useState(c.status === 'bad');
  useEffect(() => {
    if (c.status === 'bad') setOpen(true);
  }, [c.status]);
  const expandable = c.details.length > 0 || c.fixes.length > 0;
  return (
    <li className="jm-panel dg-row" data-status={c.status}>
      <div className="dg-head">
        <span className="dg-dot" aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="dg-title">{c.title}</h2>
          <p className="dg-summary">
            <span className="sr-only">{LABEL[c.status]}: </span>
            {c.summary}
          </p>
        </div>
        {action}
        {expandable && (
          <button type="button" className="jm-icon-btn dg-more" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${c.title}`} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={18} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          </button>
        )}
      </div>
      {open && expandable && (
        <div className="dg-body">
          {c.details.length > 0 && (
            <ul className="dg-details">
              {c.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
          {c.fixes.length > 0 && (
            <>
              <p className="dg-fix-h">How to fix</p>
              <ol className="dg-fixes">
                {c.fixes.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Diagnostics: microphone, camera, internet, AI service, voice, memory,
 * gestures, rendering and app errors — with troubleshooting for each.
 */
export function DiagnosticsScreen() {
  const navigate = useNavigate();
  const { online, serverLatencyMs } = useMobile();
  const errors = useErrorLog((s) => s.errors);
  const clearErrors = useErrorLog((s) => s.clear);
  const touch = useGestures((s) => s.enabled);
  const voicePrefs = useVoicePrefs();
  const [server, setServer] = useState<ServerDiag | null>(null);
  const [serverReachable, setServerReachable] = useState(true);
  const [stt, setStt] = useState<string>('');
  const [ttsServer, setTtsServer] = useState<boolean | null>(null);
  const [pending, setPending] = useState(0);
  const [mic, setMic] = useState<{ perm: Perm; test?: { peak: number } | { error: string } }>({ perm: 'unknown' });
  const [cam, setCam] = useState<{ perm: Perm; test?: { width: number; height: number } | { error: string } }>({ perm: 'unknown' });
  const [handModel, setHandModel] = useState<boolean | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [gl] = useState(webglInfo);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy('all');
    const [p1, p2] = await Promise.all([permission('microphone'), permission('camera')]);
    setMic((m) => ({ ...m, perm: p1 }));
    setCam((c) => ({ ...c, perm: p2 }));
    try {
      const res = await apiFetch('/v1/hell/diagnostics');
      if (!res.ok) throw new Error(String(res.status));
      const b = (await res.json()) as Partial<ServerDiag> | null;
      // Older or partial servers: only use the sections that are really there.
      setServer({
        hell: typeof b?.hell === 'string' ? b.hell : undefined,
        ai: b?.ai && typeof b.ai === 'object' ? b.ai : (null as unknown as ServerDiag['ai']),
        internet: b?.internet && typeof b.internet === 'object' ? b.internet : (null as unknown as ServerDiag['internet']),
        memory: b?.memory && typeof b.memory === 'object' ? b.memory : (null as unknown as ServerDiag['memory']),
        voice: b?.voice && typeof b.voice === 'object' ? b.voice : { stt: '', tts: null },
      });
      setServerReachable(true);
    } catch {
      setServer(null);
      setServerReachable(false);
    }
    const [sh, th, ms, hm] = await Promise.all([
      fetchSpeechHealth().catch(() => ({ available: false })),
      fetchTtsHealth().catch(() => ({ available: false })),
      getMemorySettings().catch(() => null),
      handModelInstalled().catch(() => false),
    ]);
    setStt(sh.available ? ((sh as { backend?: string }).backend ?? 'on') : '');
    setTtsServer(th.available);
    setPending(ms?.facts.pending ?? 0);
    setHandModel(hm);
    setFps(await measureFps());
    setBusy(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const testMic = async () => {
    setBusy('mic');
    resumeAudioContext();
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const meter = meterStream(stream);
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 2500) {
        await new Promise((r) => setTimeout(r, 50));
        peak = Math.max(peak, meter.level() ?? 0);
      }
      meter.close();
      setMic({ perm: 'granted', test: { peak } });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setMic((m) => ({ ...m, test: { error: name === 'NotAllowedError' ? 'Permission denied' : 'The microphone could not start' } }));
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setBusy(null);
    }
  };

  const testCam = async () => {
    setBusy('cam');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      const s = stream.getVideoTracks()[0]?.getSettings();
      setCam({ perm: 'granted', test: { width: s?.width ?? 0, height: s?.height ?? 0 } });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setCam((c) => ({ ...c, test: { error: name === 'NotAllowedError' ? 'Permission denied' : 'The camera could not start' } }));
    } finally {
      // Released immediately: nothing is shown or recorded.
      stream?.getTracks().forEach((t) => t.stop());
      setBusy(null);
    }
  };

  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const media = !!navigator.mediaDevices?.getUserMedia;
  const results: CheckResult[] = [
    micCheck({ supported: media, secure, permission: mic.perm, test: mic.test }),
    cameraCheck({ supported: media, secure, permission: cam.perm, test: cam.test }),
    internetCheck({ browserOnline: typeof navigator === 'undefined' || navigator.onLine, server: server?.internet ?? null, serverReachable: serverReachable && online !== false }),
    aiCheck({ serverReachable: serverReachable && online !== false, latencyMs: serverLatencyMs, ai: server?.ai ?? null }),
    voiceCheck({ stt: stt || server?.voice?.stt || '', tts: server?.voice?.tts ?? null, ttsServer, deviceVoices: deviceVoicesSupported(), deviceRec: deviceRecognitionSupported(), deviceRecAllowed: voicePrefs.allowDeviceRecognition, cloud: server?.hell === 'cloud' }),
    memoryCheck(server?.memory ?? null, pending, server?.hell === 'cloud'),
    gestureCheck({ touch, wasm: typeof WebAssembly !== 'undefined', handModel, cameraOk: secure && media && cam.perm !== 'denied' }),
    renderCheck({ ...gl, fps, dpr: window.devicePixelRatio || 1, reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false }),
    errorsCheck(errors),
  ];
  const problems = results.filter((c) => c.status === 'bad').length;
  const warnings = results.filter((c) => c.status === 'warn').length;

  const copy = async () => {
    const text = reportText(results);
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Report copied');
    } catch {
      toast.error('Could not copy — select the text in Show details instead');
    }
  };

  const testBtn = (label: string, icon: React.ReactNode, onClick: () => void, id: string) => (
    <button type="button" className="jm-icon-btn dg-test" onClick={onClick} disabled={busy !== null} aria-label={label}>
      {icon} {busy === id ? '…' : 'Test'}
    </button>
  );

  return (
    <div className="jm-scroll ges">
      <button type="button" onClick={() => navigate('/m')} className="jm-icon-btn ges-back">
        <ChevronLeft size={20} aria-hidden="true" /> HELL
      </button>
      <header className="ges-head">
        <Activity size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Diagnostics</h1>
      </header>
      <p className="ges-lead" role="status" aria-live="polite">
        {busy === 'all' ? 'Checking…' : problems ? `${problems} problem${problems > 1 ? 's' : ''} found` : warnings ? `All core systems work; ${warnings} thing${warnings > 1 ? 's' : ''} to check` : 'Everything looks good'}
      </p>
      <div className="cal-row">
        <button type="button" className="jm-primary-btn" onClick={() => void refresh()} disabled={busy !== null}>
          <RefreshCw size={16} aria-hidden="true" /> Run checks again
        </button>
        <button type="button" className="jm-icon-btn cal-wide" onClick={() => void copy()}>
          <Copy size={16} aria-hidden="true" /> Copy report
        </button>
      </div>
      <ul className="dg-list">
        {results.map((c) => (
          <Row
            key={c.id}
            c={c}
            action={
              c.id === 'mic'
                ? testBtn('Test microphone (speak for 2 seconds)', <Mic size={16} aria-hidden="true" />, () => void testMic(), 'mic')
                : c.id === 'camera'
                  ? testBtn('Test camera (opens and closes at once)', <Camera size={16} aria-hidden="true" />, () => void testCam(), 'cam')
                  : c.id === 'render'
                    ? testBtn('Measure rendering speed', <Gauge size={16} aria-hidden="true" />, () => void measureFps().then(setFps), 'fps')
                    : c.id === 'errors' && errors.length
                      ? (
                          <button type="button" className="jm-icon-btn dg-test" onClick={clearErrors}>
                            Clear
                          </button>
                        )
                      : undefined
            }
          />
        ))}
      </ul>
      <p className="ges-note">Tests run only when you tap them. The camera test opens the camera and closes it immediately; nothing is recorded or sent.</p>
    </div>
  );
}

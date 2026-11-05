/**
 * Diagnostics: turn probe results into a status with plain-language
 * troubleshooting. Pure, so every message is unit-tested.
 */
export type Status = 'ok' | 'warn' | 'bad' | 'unknown';

export interface CheckResult {
  id: string;
  title: string;
  status: Status;
  summary: string;
  details: string[];
  fixes: string[];
}

type Perm = 'granted' | 'denied' | 'prompt' | 'unknown';

const r = (id: string, title: string, status: Status, summary: string, details: string[] = [], fixes: string[] = []): CheckResult => ({ id, title, status, summary, details, fixes });

const HTTPS_FIX = 'Open HELL through its https:// address (the camera and microphone only work on secure pages).';

export function micCheck(p: { supported: boolean; secure: boolean; permission: Perm; test?: { peak: number } | { error: string } }): CheckResult {
  const t = 'Microphone';
  if (!p.secure) return r('mic', t, 'bad', 'Blocked: this page is not secure', [], [HTTPS_FIX]);
  if (!p.supported) return r('mic', t, 'bad', 'This browser has no microphone access', [], ['Use Safari on iPhone (iOS 16 or later).']);
  if (p.permission === 'denied' || (p.test && 'error' in p.test && /denied|not allowed/i.test(p.test.error))) {
    return r('mic', t, 'bad', 'Permission denied', [], ['On iPhone: Settings › Safari › Microphone › Ask or Allow, then reload HELL (this also covers the home-screen app).']);
  }
  if (p.test && 'error' in p.test) return r('mic', t, 'bad', p.test.error, [], ['Close other apps using the microphone (calls, recorders) and try again.']);
  if (p.test && 'peak' in p.test) {
    return p.test.peak > 0.02
      ? r('mic', t, 'ok', 'Working — HELL heard you', [`Peak level ${Math.round(p.test.peak * 100)}%`])
      : r('mic', t, 'warn', 'Connected, but it heard nothing', [`Peak level ${Math.round(p.test.peak * 100)}%`], ['Speak during the test.', 'Check the phone is not muted by a Bluetooth headset that is out of range.']);
  }
  if (p.permission === 'granted') return r('mic', t, 'ok', 'Allowed', [], []);
  return r('mic', t, 'unknown', 'Not tested yet — tap Test', [], []);
}

export function cameraCheck(p: { supported: boolean; secure: boolean; permission: Perm; test?: { width: number; height: number } | { error: string } }): CheckResult {
  const t = 'Camera';
  if (!p.secure) return r('camera', t, 'bad', 'Blocked: this page is not secure', [], [HTTPS_FIX]);
  if (!p.supported) return r('camera', t, 'bad', 'This browser has no camera access', [], ['Use Safari on iPhone (iOS 16 or later).']);
  if (p.permission === 'denied' || (p.test && 'error' in p.test && /denied|not allowed/i.test(p.test.error))) {
    return r('camera', t, 'bad', 'Permission denied', [], ['On iPhone: Settings › Safari › Camera › Ask or Allow, then reload HELL.']);
  }
  if (p.test && 'error' in p.test) return r('camera', t, 'bad', p.test.error, [], ['Close other apps using the camera and try again.']);
  if (p.test && 'width' in p.test) return r('camera', t, 'ok', 'Working', [`${p.test.width}×${p.test.height}`]);
  if (p.permission === 'granted') return r('camera', t, 'ok', 'Allowed');
  return r('camera', t, 'unknown', 'Not tested yet — tap Test');
}

export function internetCheck(p: { browserOnline: boolean; server: { ok: boolean; latency_ms?: number; error?: string } | null; serverReachable: boolean }): CheckResult {
  const t = 'Internet connection';
  if (!p.browserOnline) return r('internet', t, 'bad', 'This iPhone is offline', [], ['Turn off Airplane Mode and check Wi-Fi or mobile data.']);
  if (!p.serverReachable) return r('internet', t, 'warn', 'Phone is online, HELL server unreachable', [], ['See “AI service” below.']);
  if (!p.server) return r('internet', t, 'unknown', 'Not checked');
  if (p.server.ok) return r('internet', t, 'ok', 'Online', [`Server reaches the internet in ${p.server.latency_ms ?? '?'} ms`]);
  return r('internet', t, 'warn', 'Your HELL server has no internet', [p.server.error ?? ''].filter(Boolean), ['HELL still works locally; weather and web tools need the server to reach the internet.', 'Check the server computer’s network or firewall.']);
}

export function aiCheck(p: { serverReachable: boolean; latencyMs: number | null; ai: { engine: string; model: string; healthy: boolean; models: number; latency_ms: number | null; error?: string } | null }): CheckResult {
  const t = 'AI service';
  if (!p.serverReachable) {
    return r('ai', t, 'bad', 'Can’t reach your HELL server', [], ['Make sure the computer running HELL is on and `jarvis serve` is running.', 'Check the iPhone is on the same network (or your VPN/tunnel is up).', 'Try opening the HELL address in Safari.']);
  }
  const details = p.latencyMs != null ? [`Server round trip ${p.latencyMs} ms`] : [];
  if (!p.ai) return r('ai', t, 'unknown', 'Server reachable; engine not checked', details);
  details.push(`Engine: ${p.ai.engine || 'unknown'}`, `Model: ${p.ai.model || 'none selected'}`, `${p.ai.models} model(s) installed`);
  if (!p.ai.healthy) return r('ai', t, 'bad', 'The AI engine is not responding', [...details, p.ai.error ?? ''].filter(Boolean), ['Start your engine (e.g. run `ollama serve`).', 'Restart `jarvis serve` after the engine is up.']);
  if (!p.ai.models) return r('ai', t, 'warn', 'Engine running, no models installed', details, ['Install a model, e.g. `ollama pull qwen3:8b`.']);
  return r('ai', t, 'ok', 'Connected', details);
}

export function voiceCheck(p: { stt: string; tts: string | null; ttsServer: boolean | null; deviceVoices: boolean; deviceRec: boolean; deviceRecAllowed: boolean }): CheckResult {
  const t = 'Voice engine';
  const listen = p.stt ? `Listening: HELL server (${p.stt})` : p.deviceRec && p.deviceRecAllowed ? 'Listening: iPhone speech recognition' : 'Listening: unavailable';
  const speakServer = p.ttsServer === true || !!p.tts;
  const speak = speakServer ? `Speaking: HELL server${p.tts ? ` (${p.tts})` : ''}` : p.deviceVoices ? 'Speaking: iPhone voice' : 'Speaking: unavailable';
  const canListen = !!p.stt || (p.deviceRec && p.deviceRecAllowed);
  const canSpeak = speakServer || p.deviceVoices;
  const fixes: string[] = [];
  if (!p.stt) fixes.push('For private voice input, install a transcriber on the server: `pip install faster-whisper` then restart `jarvis serve`.');
  if (!p.stt && p.deviceRec && !p.deviceRecAllowed) fixes.push('Or allow iPhone speech recognition in Settings › Voice.');
  if (!speakServer) fixes.push('For HELL’s own voice, install Kokoro on the server (free, local); until then the iPhone voice is used.');
  const status: Status = canListen && canSpeak ? (p.stt && speakServer ? 'ok' : 'warn') : 'bad';
  return r('voice', t, status, canListen && canSpeak ? 'Ready' : !canListen ? 'HELL can’t listen' : 'HELL can’t speak', [listen, speak], status === 'ok' ? [] : fixes);
}

export function memoryCheck(m: { store: string; entries: number; learning: string; use_in_replies: boolean; learner_running: boolean; error?: string } | null, pending: number): CheckResult {
  const t = 'Memory system';
  if (!m) return r('memory', t, 'unknown', 'Not checked');
  if (m.store === 'error') return r('memory', t, 'bad', 'Memory store failed', [m.error ?? ''], ['Restart `jarvis serve`; if it persists, reinstall HELL’s native extension.']);
  const details = [`Saved entries: ${m.entries}`, `Learning: ${m.learning === 'ask' ? 'asks first' : m.learning}`, `Used in replies: ${m.use_in_replies ? 'yes' : 'no'}`];
  if (pending) details.push(`${pending} fact(s) waiting for approval`);
  if (!m.use_in_replies && m.learning === 'off') return r('memory', t, 'warn', 'Memory is off', details, ['Turn it on in Memory if you want HELL to remember things.']);
  if (m.learning !== 'off' && !m.learner_running) return r('memory', t, 'warn', 'Learning is on but not running', details, ['Check the AI service above; learning needs a model.']);
  return r('memory', t, pending ? 'warn' : 'ok', pending ? 'Facts waiting for your approval' : 'Working', details, pending ? ['Open Memory to approve or forget them.'] : []);
}

export function gestureCheck(p: { touch: boolean; wasm: boolean; handModel: boolean | null; cameraOk: boolean }): CheckResult {
  const t = 'Gesture recognition';
  const details = [`Touch gestures: ${p.touch ? 'on' : 'off'}`, `Hand gestures: ${!p.wasm ? 'not supported here' : p.handModel === false ? 'model missing' : p.handModel ? 'ready' : 'not checked'}`];
  const fixes: string[] = [];
  if (!p.touch) fixes.push('Turn touch gestures on in Gestures.');
  if (p.handModel === false) fixes.push('Rebuild the HELL app once with internet access so it can download the 8 MB hand model.');
  if (!p.wasm) fixes.push('Hand gestures need a newer browser (iOS 16.4 or later).');
  if (!p.cameraOk) fixes.push('Hand gestures also need the camera (see above).');
  const status: Status = !p.touch && (p.handModel === false || !p.wasm) ? 'bad' : fixes.length ? 'warn' : 'ok';
  return r('gestures', t, status, status === 'ok' ? 'Ready' : status === 'bad' ? 'Not available' : 'Partly available', details, fixes);
}

export function renderCheck(p: { webgl2: boolean; webgl: boolean; fps: number | null; dpr: number; reducedMotion: boolean; renderer?: string }): CheckResult {
  const t = 'Rendering performance';
  const details = [`WebGL: ${p.webgl2 ? '2' : p.webgl ? '1' : 'none'}`, `Pixel ratio: ${p.dpr}`, p.renderer ? `GPU: ${p.renderer}` : '', p.reducedMotion ? 'Reduce Motion is on (animations simplified)' : ''].filter(Boolean);
  if (p.fps != null) details.unshift(`${Math.round(p.fps)} frames per second`);
  if (!p.webgl) return r('render', t, 'warn', 'No 3D graphics — HELL uses a simpler orb', details, ['Update iOS; turn off Low Power Mode.']);
  if (p.fps == null) return r('render', t, 'unknown', '3D available; speed not measured', details);
  if (p.fps < 24) return r('render', t, 'bad', 'Slow', details, ['Lower particle density in Settings › Orb.', 'Turn off Low Power Mode.', 'Close other apps and tabs.']);
  if (p.fps < 45) return r('render', t, 'warn', 'A bit slow', details, ['Lower particle density in Settings › Orb.']);
  return r('render', t, 'ok', 'Smooth', details);
}

export function errorsCheck(errors: { t: number; message: string; source: string }[]): CheckResult {
  const t = 'Application errors';
  if (!errors.length) return r('errors', t, 'ok', 'No errors this session');
  const details = errors.slice(-5).reverse().map((e) => `${new Date(e.t).toLocaleTimeString()} · ${e.message}`);
  return r('errors', t, 'warn', `${errors.length} error(s) this session`, details, ['Reload HELL. If an error keeps coming back, copy this report and keep it for troubleshooting.']);
}

export function reportText(results: CheckResult[], at = new Date()): string {
  const icon: Record<Status, string> = { ok: 'OK ', warn: 'WARN', bad: 'FAIL', unknown: '?  ' };
  const lines = [`HELL diagnostics — ${at.toISOString()}`];
  for (const c of results) {
    lines.push(`[${icon[c.status]}] ${c.title}: ${c.summary}`);
    for (const d of c.details) lines.push(`        ${d}`);
  }
  return lines.join('\n');
}

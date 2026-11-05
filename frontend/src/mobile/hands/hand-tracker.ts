/**
 * On-device hand gesture recognition with MediaPipe Tasks Vision
 * (Apache-2.0). The runtime and model are served by your own HELL server
 * (see scripts/hand-assets.mjs) and loaded only when hand gestures are
 * turned on. Video frames are processed in this page and never uploaded.
 */
import type { GestureRecognizer } from '@mediapipe/tasks-vision';

const BASE = `${import.meta.env.BASE_URL ?? '/'}mediapipe/`;
const MODEL = `${BASE}gesture_recognizer.task`;

export class HandTrackingUnavailable extends Error {}

/**
 * MediaPipe Tasks posts usage statistics (task type, timings; no images) to
 * Google every minute, with no option to turn it off. HELL keeps everything
 * on your network: those requests are refused here (and by the server's
 * Content-Security-Policy), which makes the library stop trying.
 */
export function isMediaPipeTelemetry(url: string): boolean {
  try {
    return new URL(url, 'http://local.invalid').hostname === 'odml.pa.googleapis.com';
  } catch {
    return false;
  }
}

let guarded = false;
function blockMediaPipeTelemetry() {
  if (guarded || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  guarded = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isMediaPipeTelemetry(url)) return Promise.resolve(new Response(null, { status: 403 }));
    return original(input, init);
  };
}

let loading: Promise<GestureRecognizer> | null = null;

/** Missing files fall through to the app's index.html; detect that honestly. */
async function assertModelPresent() {
  // GET (the server refuses HEAD), read only the headers, then abort.
  const ctrl = new AbortController();
  const res = await fetch(MODEL, { signal: ctrl.signal }).catch(() => null);
  const type = res?.headers.get('content-type') ?? '';
  ctrl.abort();
  if (!res || !res.ok || type.includes('text/html')) {
    throw new HandTrackingUnavailable('The hand gesture model is not installed on your HELL server. Rebuild the app with internet access once (it downloads an 8 MB open-source model).');
  }
}

export function loadRecognizer(): Promise<GestureRecognizer> {
  if (!loading) {
    loading = (async () => {
      if (typeof WebAssembly === 'undefined') throw new HandTrackingUnavailable('This browser cannot run on-device hand tracking.');
      blockMediaPipeTelemetry();
      await assertModelPresent();
      const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
      const make = (delegate: 'GPU' | 'CPU') =>
        GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      try {
        return await make('GPU');
      } catch {
        return await make('CPU');
      }
    })().catch((e) => {
      loading = null;
      throw e instanceof HandTrackingUnavailable ? e : new HandTrackingUnavailable(`Hand tracking could not start: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
  return loading;
}

export interface HandFrame {
  /** Top category for the hand, if one is in view. */
  category: string | undefined;
  score: number;
  handSeen: boolean;
  t: number;
}

/**
 * Run the recogniser on `video` at about `fps` frames per second (a low
 * rate saves battery; gestures are held for half a second anyway).
 * Returns a stop function.
 */
export function runRecognizer(rec: GestureRecognizer, video: HTMLVideoElement, onFrame: (f: HandFrame) => void, fps = 8): () => void {
  let raf = 0;
  let last = 0;
  let lastVideoTime = -1;
  let stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (now - last < 1000 / fps || video.readyState < 2 || !video.videoWidth) return;
    if (video.currentTime === lastVideoTime) return;
    last = now;
    lastVideoTime = video.currentTime;
    try {
      const r = rec.recognizeForVideo(video, now);
      const top = r.gestures?.[0]?.[0];
      onFrame({ category: top?.categoryName, score: top?.score ?? 0, handSeen: (r.landmarks?.length ?? 0) > 0, t: now });
    } catch {
      // A dropped frame; keep going.
    }
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

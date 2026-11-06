import { create } from 'zustand';

/**
 * One shared camera for HELL (Vision screen + Hologram Builder camera
 * displays). Privacy rules:
 *  - it only starts from an explicit user action (iOS also requires that);
 *  - it stops when nothing on screen is using it, when the page is hidden,
 *    and whenever the user taps "camera off";
 *  - frames never leave the device unless `captureFrame` is called for a
 *    question the user asked.
 */

export type Facing = 'environment' | 'user';
export type CameraStatus = 'off' | 'starting' | 'on' | 'error';

interface CameraState {
  stream: MediaStream | null;
  facing: Facing;
  status: CameraStatus;
  error: string | null;
  /** A captured frame is being analysed (drives the orb's vision state). */
  analyzing: boolean;
  /** `size` lowers the resolution (hand tracking needs far less than Vision). */
  start: (facing?: Facing, size?: { width: number; height: number }) => Promise<void>;
  stop: () => void;
  flip: () => Promise<void>;
  setAnalyzing: (on: boolean) => void;
}

export function describeCameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. On iPhone: Settings › Safari › Camera › Allow (or Ask), then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is busy in another app. Close it and try again.';
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'The camera needs HTTPS. Open HELL through your https:// address.';
  return 'The camera could not be started.';
}

export const useCamera = create<CameraState>((set, get) => ({
  stream: null,
  facing: 'environment',
  status: 'off',
  error: null,
  analyzing: false,

  start: async (facing, size) => {
    const want = facing ?? get().facing;
    get().stream?.getTracks().forEach((t) => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) {
      set({ status: 'error', error: window.isSecureContext ? 'This browser has no camera access.' : 'The camera needs HTTPS. Open HELL through your https:// address.', stream: null });
      return;
    }
    set({ status: 'starting', error: null, facing: want });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: want }, width: { ideal: size?.width ?? 1280 }, height: { ideal: size?.height ?? 720 } },
      });
      // A stop() may have happened while the permission prompt was open.
      if (get().status !== 'starting') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      set({ stream, status: 'on' });
    } catch (e) {
      set({ status: 'error', error: describeCameraError(e), stream: null });
    }
  },

  stop: () => {
    get().stream?.getTracks().forEach((t) => t.stop());
    set({ stream: null, status: 'off', analyzing: false });
  },

  flip: async () => {
    const next: Facing = get().facing === 'environment' ? 'user' : 'environment';
    if (get().status === 'on') await get().start(next);
    else set({ facing: next });
  },

  setAnalyzing: (on) => set({ analyzing: on }),
}));

// Background tab / locked phone: release the camera immediately.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && useCamera.getState().status !== 'off') useCamera.getState().stop();
  });
}

/**
 * Grab the current video frame as a JPEG (base64, no data: prefix), scaled so
 * the long side is at most `maxSide` px. Small enough to send quickly, big
 * enough for a vision model to read text.
 */
export function captureFrame(video: HTMLVideoElement, maxSide = 1024, quality = 0.82): { base64: string; dataUrl: string } | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

/**
 * A blob: URL for showing a captured frame. The server's CSP allows blob:
 * images (img-src 'self' blob:) but not data: ones; call URL.revokeObjectURL when it is no longer shown.
 */
export function frameObjectUrl(base64: string, type = 'image/jpeg'): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

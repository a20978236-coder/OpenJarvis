/**
 * Recording-format helpers for voice input.
 *
 * Browsers disagree on what MediaRecorder produces: Chrome and Firefox record
 * WebM/Opus, while Safari on iPhone and macOS records MP4/AAC. The server picks
 * the decoder from the uploaded filename's extension, so the upload must be
 * named after what was actually recorded -- labelling Safari's MP4 as
 * `recording.webm` makes cloud speech backends reject or misdecode it.
 */

/** Container types to try, in preference order. */
export const PREFERRED_RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

/**
 * First recording type this browser supports, or `undefined` to let the
 * browser choose (also the answer when `isTypeSupported` is unavailable).
 */
export function pickRecordingMimeType(
  isTypeSupported: ((type: string) => boolean) | undefined =
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? (t) => MediaRecorder.isTypeSupported(t)
      : undefined,
): string | undefined {
  if (!isTypeSupported) return undefined;
  return PREFERRED_RECORDING_TYPES.find((t) => {
    try {
      return isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

/**
 * File extension the server should use to decode a recording of `mimeType`.
 *
 * MP4/AAC maps to `m4a` because that is the audio-only extension every
 * configured backend understands (Deepgram's MIME map, OpenAI Whisper, and
 * ffmpeg for faster-whisper). Unknown or empty types fall back to `webm`,
 * matching the previous hard-coded behaviour.
 */
export function extensionForMimeType(mimeType: string | null | undefined): string {
  const base = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
    case 'audio/aac':
    case 'video/mp4':
      return 'm4a';
    case 'audio/ogg':
    case 'audio/opus':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    default:
      return 'webm';
  }
}

/** Upload filename for a recording of `mimeType`, e.g. `recording.m4a`. */
export function recordingFilename(mimeType: string | null | undefined): string {
  return `recording.${extensionForMimeType(mimeType)}`;
}

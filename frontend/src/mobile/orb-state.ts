import type { OrbState } from './orb-types';
import type { SpeechState } from '../hooks/useSpeech';
import type { TtsState } from '../lib/tts';

export interface OrbInputs {
  /** Backend health: null while the first check is pending. */
  online: boolean | null;
  speech: SpeechState;
  isStreaming: boolean;
  /** Text streamed so far for the in-flight reply. */
  streamContent: string;
  tts: TtsState;
}

/**
 * What the orb should show, in priority order: the user's own voice first
 * (listening), then Jarvis speaking aloud, then any work in flight.
 */
export function deriveOrbState(i: OrbInputs): OrbState {
  if (i.online === false) return 'offline';
  if (i.speech === 'recording') return 'listening';
  if (i.tts === 'speaking') return 'speaking';
  if (i.speech === 'transcribing' || i.tts === 'loading') return 'thinking';
  if (i.isStreaming) return i.streamContent ? 'speaking' : 'thinking';
  return 'idle';
}

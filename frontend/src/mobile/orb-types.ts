/** Everything the orb can show. `activating` is the scatter-and-reform burst. */
export type OrbState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'vision'
  | 'error'
  | 'activating'
  | 'offline';

export const ORB_CAPTIONS: Record<OrbState, string> = {
  idle: 'Double-tap to talk',
  listening: 'Listening… tap to send',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  vision: 'Scanning…',
  error: 'Something went wrong',
  activating: 'HELL online',
  offline: 'Offline',
};

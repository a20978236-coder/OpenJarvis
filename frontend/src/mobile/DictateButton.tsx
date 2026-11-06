import { useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useMobile } from './MobileShell';

/**
 * Mic button that dictates into a field: tap to listen, tap again to stop,
 * and the transcript is handed to `onText`. Hidden when the server has no
 * speech-to-text backend.
 */
export function DictateButton({ onText, label = 'Dictate' }: { onText: (text: string) => void; label?: string }) {
  const { speechAvailable, speechState, listen, dictate, online } = useMobile();
  // Only the button that started a recording should receive its transcript.
  const [mine, setMine] = useState(false);

  if (!speechAvailable) return null;
  const recording = mine && speechState === 'recording';
  const busy = speechState === 'transcribing' || (speechState === 'recording' && !mine);

  const onClick = async () => {
    if (recording) {
      const text = await dictate();
      setMine(false);
      if (text) onText(text);
      return;
    }
    setMine(true);
    await listen();
  };

  return (
    <button
      type="button"
      className="jm-icon-btn"
      onClick={() => void onClick()}
      disabled={busy || online === false}
      aria-pressed={recording}
      aria-label={recording ? 'Stop dictation' : label}
      style={recording ? { color: '#fff', background: 'var(--jm-danger)', borderColor: 'transparent' } : undefined}
    >
      {recording ? <Square size={16} fill="currentColor" /> : <Mic size={18} className={mine && speechState === 'transcribing' ? 'jm-pulse' : undefined} />}
    </button>
  );
}

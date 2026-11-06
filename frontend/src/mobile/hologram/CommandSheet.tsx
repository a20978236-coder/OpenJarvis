import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Wand2, X } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { DictateButton } from '../DictateButton';
import { useMobile } from '../MobileShell';
import { SUGGESTIONS } from './holo-ai';
import { runHoloCommand, type CommandSource } from './holo-runner';

interface Entry {
  id: number;
  text: string;
  reply: string;
  source: CommandSource;
  ok: boolean;
}

const SOURCE_LABEL: Record<CommandSource, string> = { 'built-in': 'Built-in command', ai: 'AI model', none: 'Not applied' };

/**
 * "Ask HELL" for the Hologram Builder: type or say what to build. Results are
 * real edits (one undo step per request); the log says what happened and
 * whether the built-in parser or the AI model handled it.
 */
export function CommandSheet({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const model = useAppStore((s) => s.selectedModel);
  const { flashError, activate } = useMobile();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const ran = useRef(false);

  const run = async (command: string) => {
    const c = command.trim();
    if (!c || busy) return;
    setBusy(true);
    setText('');
    abort.current = new AbortController();
    try {
      const out = await runHoloCommand(c, model, abort.current.signal);
      setLog((l) => [{ id: Date.now(), text: c, reply: out.reply, source: out.source, ok: out.ok }, ...l].slice(0, 6));
      if (out.ok) activate();
      else flashError();
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  useEffect(() => {
    if (initial && !ran.current) {
      ran.current = true;
      void run(initial);
    }
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abort.current?.abort();
    };
  }, [onClose]);

  return (
    <div className="holo-sheet" role="dialog" aria-modal="false" aria-label="Ask HELL to build" data-tall>
      <div className="holo-sheet-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Wand2 size={18} aria-hidden="true" style={{ color: 'var(--jm-cyan)' }} /> Ask HELL to build
        </h2>
        <button type="button" className="jm-icon-btn" onClick={onClose} aria-label="Close Ask HELL">
          <X size={18} />
        </button>
      </div>
      <div className="holo-sheet-body">
        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void run(text);
          }}
        >
          <label className="sr-only" htmlFor="holo-command">What should HELL build?</label>
          <input
            id="holo-command"
            ref={inputRef}
            className="jm-field"
            placeholder="e.g. build a rotating planet"
            value={text}
            onChange={(e) => setText(e.target.value)}
            enterKeyHint="go"
            disabled={busy}
            autoComplete="off"
          />
          <DictateButton label="Say a command" onText={(t) => void run(t)} />
          <button type="submit" className="jm-primary-btn" style={{ width: 44, padding: 0, flexShrink: 0 }} disabled={!text.trim() || busy} aria-label="Run command">
            <Send size={18} />
          </button>
        </form>

        <div className="holo-chips" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="holo-chip" onClick={() => void run(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>

        <div role="log" aria-live="polite" className="holo-log">
          {busy && <p className="holo-log-busy jm-pulse">Working on it…</p>}
          {log.map((e) => (
            <div key={e.id} className="holo-log-entry" data-ok={e.ok || undefined}>
              <p className="holo-log-you">“{e.text}”</p>
              <p className="holo-log-reply">
                <Bot size={14} aria-hidden="true" /> {e.reply}
              </p>
              <p className="holo-log-source">{SOURCE_LABEL[e.source]}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, LayoutGrid, Play, Plus, Trash2 } from 'lucide-react';
import { MODULES } from '../dashboard/modules';
import { runShortcut, useShortcuts } from './shortcuts';
import '../gestures/gestures.css';
import './apps.css';

/**
 * Apps: HELL's own tools in one place, plus buttons that run your iOS
 * Shortcuts (home, music, messages, anything you have built in Shortcuts).
 */
export function AppsScreen() {
  const navigate = useNavigate();
  const { buttons, add, remove } = useShortcuts();
  const [label, setLabel] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [input, setInput] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const tools = MODULES.filter((m) => m.stage === null && m.id !== 'apps');

  return (
    <div className="jm-scroll ges">
      <button type="button" onClick={() => navigate('/m')} className="jm-icon-btn ges-back">
        <ChevronLeft size={20} aria-hidden="true" /> HELL
      </button>
      <header className="ges-head">
        <LayoutGrid size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Apps</h1>
      </header>

      <section aria-labelledby="apps-tools">
        <h2 id="apps-tools" className="jm-label">HELL tools</h2>
        <div className="apps-grid">
          {tools.map((m) => {
            const Icon = m.icon;
            return (
              <button key={m.id} type="button" className="jm-panel apps-tile" onClick={() => navigate(m.route)}>
                <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="apps-sc" className="cal-section">
        <h2 id="apps-sc" className="jm-label">Your iOS Shortcuts</h2>
        {buttons.length === 0 ? (
          <p className="cal-p">Add a button for any shortcut in Apple’s Shortcuts app — lights, music, messages, a note — and run it from here, or say “HELL, run shortcut …”.</p>
        ) : (
          <ul className="mem-list">
            {buttons.map((b) => (
              <li key={b.id} className="jm-panel apps-sc-row">
                <button type="button" className="apps-run" onClick={() => runShortcut(b)} aria-label={`Run shortcut ${b.label}`}>
                  <Play size={18} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span className="files-name">{b.label}</span>
                    <span className="mem-meta">
                      Shortcut “{b.shortcut}”{b.input ? ` · input “${b.input.slice(0, 30)}”` : ''}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="jm-icon-btn files-act mem-danger"
                  data-armed={armed === b.id || undefined}
                  onClick={() => (armed === b.id ? (remove(b.id), setArmed(null)) : setArmed(b.id))}
                  aria-label={armed === b.id ? `Tap again to remove ${b.label}` : `Remove ${b.label}`}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {armed === b.id ? 'Tap again' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="jm-panel ges-card cal-section apps-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!shortcut.trim()) return;
            add({ label: label.trim() || shortcut.trim(), shortcut: shortcut.trim(), input: input.trim() });
            setLabel('');
            setShortcut('');
            setInput('');
          }}
        >
          <h3 className="cal-h">Add a shortcut button</h3>
          <label className="holo-field">
            <span>Shortcut name (exactly as in the Shortcuts app)</span>
            <input className="jm-field" value={shortcut} onChange={(e) => setShortcut(e.target.value)} maxLength={100} placeholder="e.g. Lights off" autoCapitalize="words" />
          </label>
          <label className="holo-field">
            <span>Button label (optional)</span>
            <input className="jm-field" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
          </label>
          <label className="holo-field">
            <span>Text to pass in (optional)</span>
            <input className="jm-field" value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} />
          </label>
          <button type="submit" className="jm-primary-btn" disabled={!shortcut.trim()}>
            <Plus size={16} aria-hidden="true" /> Add button
          </button>
          <p className="ges-note">
            Tapping a button opens the Shortcuts app to run it; iOS may ask you to confirm the first time. HELL can only start shortcuts you add here, and it can’t see
            what they do or their results.
          </p>
        </form>
      </section>
    </div>
  );
}

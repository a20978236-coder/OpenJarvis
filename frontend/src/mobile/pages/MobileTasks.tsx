import { CheckSquare } from 'lucide-react';

/** Placeholder until the personal notes & tasks API lands (next phase). */
export function MobileTasks() {
  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Tasks & Notes</h1>
      </header>
      <div className="jm-panel" style={{ padding: 24, textAlign: 'center' }}>
        <CheckSquare size={32} style={{ color: 'var(--jm-blue)', margin: '0 auto 10px' }} aria-hidden="true" />
        <p style={{ fontSize: 15 }}>Coming next.</p>
        <p style={{ fontSize: 13, color: 'var(--jm-text-2)', marginTop: 4 }}>
          Your tasks and notes will be stored on your own server.
        </p>
      </div>
    </div>
  );
}

import { Navigate, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Construction } from 'lucide-react';
import { moduleById, STAGE_NAMES } from '../dashboard/modules';

/**
 * Landing page for a dashboard module that is not built yet. It says so
 * plainly instead of showing a mock UI. Ready modules redirect to their screen.
 */
export function ModuleScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const m = moduleById(id);
  if (!m) return <Navigate to="/m" replace />;
  if (m.stage === null) return <Navigate to={m.route} replace />;
  const Icon = m.icon;

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button
        type="button"
        onClick={() => navigate('/m')}
        className="jm-icon-btn"
        style={{ width: 'auto', padding: '0 12px 0 6px', alignSelf: 'flex-start', gap: 4 }}
      >
        <ChevronLeft size={20} aria-hidden="true" /> HELL
      </button>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon size={34} strokeWidth={1.6} style={{ color: 'var(--jm-cyan)' }} aria-hidden="true" />
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>{m.label}</h1>
      </header>
      <p style={{ fontSize: 16, color: 'var(--jm-text-2)', lineHeight: 1.5 }}>{m.summary}</p>
      <div className="jm-panel" style={{ padding: 18, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Construction size={22} style={{ color: '#ffb547', flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
        <div>
          <p style={{ fontSize: 15, fontWeight: 600 }}>Not built yet</p>
          <p style={{ fontSize: 14, color: 'var(--jm-text-2)', marginTop: 4 }}>
            Arriving in {STAGE_NAMES[m.stage] ?? `stage ${m.stage}`}. Nothing on this screen works yet.
          </p>
        </div>
      </div>
    </div>
  );
}

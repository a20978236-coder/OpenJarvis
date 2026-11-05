import { useEffect, useRef } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { ORB_PALETTES, useOrbPrefs, type OrbDensity, type OrbPalette } from './orb-prefs';

function Slider({ id, label, value, min, max, step, onChange, format }: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <label htmlFor={id} className="jm-label">{label}</label>
        <span style={{ fontSize: 13, color: 'var(--jm-text-2)' }}>{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        className="hell-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Bottom sheet for orb appearance. Changes apply live and save on this device. */
export function OrbCustomizer({ onClose }: { onClose: () => void }) {
  const prefs = useOrbPrefs();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="hell-sheet-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hell-orb-title"
        className="hell-sheet jm-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id="hell-orb-title" style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Orb</h2>
          <button type="button" className="jm-icon-btn" onClick={() => prefs.reset()} aria-label="Reset orb to defaults">
            <RotateCcw size={18} />
          </button>
          <button ref={closeRef} type="button" className="jm-icon-btn" onClick={onClose} aria-label="Close orb settings">
            <X size={20} />
          </button>
        </div>

        <fieldset style={{ border: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="jm-label" style={{ marginBottom: 8 }}>Color</legend>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(Object.keys(ORB_PALETTES) as OrbPalette[]).map((key) => {
              const p = ORB_PALETTES[key];
              const on = prefs.palette === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => prefs.update({ palette: key })}
                  aria-pressed={on}
                  aria-label={p.label}
                  title={p.label}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    border: on ? '2px solid #fff' : '2px solid transparent',
                    background: `radial-gradient(circle at 35% 35%, ${p.hot}, ${p.accent} 35%, ${p.core} 70%)`,
                    boxShadow: on ? `0 0 16px ${p.core}` : 'none',
                  }}
                />
              );
            })}
          </div>
        </fieldset>

        <fieldset style={{ border: 'none' }}>
          <legend className="jm-label" style={{ marginBottom: 8 }}>Particle density</legend>
          <div role="radiogroup" aria-label="Particle density" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {(['low', 'medium', 'high'] as OrbDensity[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={prefs.density === d}
                disabled={prefs.reducedEffects}
                onClick={() => prefs.update({ density: d })}
                className="jm-icon-btn hell-choice"
                style={{ width: '100%', textTransform: 'capitalize', fontSize: 14 }}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>

        <Slider id="hell-orb-size" label="Size" value={prefs.scale} min={0.7} max={1.3} step={0.05} onChange={(v) => prefs.update({ scale: v })} format={pct} />
        <Slider id="hell-orb-speed" label="Animation speed" value={prefs.speed} min={0.5} max={1.8} step={0.05} onChange={(v) => prefs.update({ speed: v })} format={pct} />
        <Slider id="hell-orb-glow" label="Glow" value={prefs.glow} min={0.4} max={1.6} step={0.05} onChange={(v) => prefs.update({ glow: v })} format={pct} />

        <label style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: 'pointer' }}>
          <input
            type="checkbox"
            className="hell-switch"
            checked={prefs.reducedEffects}
            onChange={(e) => prefs.update({ reducedEffects: e.target.checked })}
          />
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 15 }}>Reduced effects</span>
            <span style={{ fontSize: 12, color: 'var(--jm-text-3)' }}>Fewer particles, no links or trails, 30 fps — saves battery.</span>
          </span>
        </label>
      </div>
    </div>
  );
}

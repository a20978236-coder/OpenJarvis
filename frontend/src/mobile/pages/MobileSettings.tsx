import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Activity, Boxes, Brain, Camera, ChevronRight, CloudSun, Crosshair, Hand, LogOut, Mic, Monitor, RotateCcw, Sparkles, Volume2 } from 'lucide-react';
import { UI_LIMITS, useUiPrefs, type AnimationLevel } from '../../lib/ui-prefs';
import '../gestures/gestures.css';
import { useAppStore } from '../../lib/store';
import { useTtsStore } from '../../lib/tts';
import { useWeatherPrefs } from '../../lib/weather-api';
import { WeatherSheet } from '../dashboard/WeatherCard';
import { useMobile } from '../MobileShell';

function Row({ icon, title, detail, onClick, href }: { icon: React.ReactNode; title: string; detail?: string; onClick?: () => void; href?: string }) {
  const content = (
    <>
      <span style={{ color: 'var(--jm-cyan)', display: 'flex' }} aria-hidden="true">{icon}</span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
        <span style={{ fontSize: 15 }}>{title}</span>
        {detail && <span style={{ fontSize: 12.5, color: 'var(--jm-text-3)' }}>{detail}</span>}
      </span>
      <ChevronRight size={18} style={{ color: 'var(--jm-text-3)' }} aria-hidden="true" />
    </>
  );
  const style: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 56, padding: '8px 14px', color: 'inherit', textDecoration: 'none', cursor: 'pointer', borderRadius: 14 };
  return href ? (
    <a href={href} className="jm-panel" style={style}>{content}</a>
  ) : (
    <button type="button" onClick={onClick} className="jm-panel" style={style}>{content}</button>
  );
}

type Perm = 'granted' | 'denied' | 'prompt' | 'unknown';
async function permission(name: string): Promise<Perm> {
  try {
    return ((await navigator.permissions?.query({ name: name as PermissionName }))?.state as Perm) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const PERM_TEXT: Record<Perm, string> = { granted: 'Allowed', denied: 'Blocked', prompt: 'Asks each time', unknown: 'Asked when first used' };

/**
 * The customization centre: orb, interface, voice, gestures, privacy and
 * permissions. Everything here is saved on this device.
 */
export function MobileSettings() {
  const { openOrbSettings, authVia, signOut } = useMobile();
  const navigate = useNavigate();
  const voiceOut = useAppStore((s) => s.settings.voiceOutputEnabled && s.settings.voiceAutoplay);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const weather = useWeatherPrefs((s) => s.source);
  const [weatherOpen, setWeatherOpen] = useState(false);

  const weatherDetail =
    weather.kind === 'off' ? 'Off' : weather.kind === 'city' ? weather.city : 'Your location (≈1 km)';

  const ui = useUiPrefs();
  const [camPerm, setCamPerm] = useState<Perm>('unknown');
  const [micPerm, setMicPerm] = useState<Perm>('unknown');
  useEffect(() => {
    void permission('camera').then(setCamPerm);
    void permission('microphone').then(setMicPerm);
  }, []);

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 2 }}>Settings</h1>
      <p style={{ fontSize: 13.5, color: 'var(--jm-text-3)', marginBottom: 4 }}>Saved on this iPhone.</p>

      <h2 className="jm-label set-h">Appearance</h2>
      <Row icon={<Sparkles size={20} />} title="Orb" detail="Colors, particle density, size, animation speed, glow" onClick={openOrbSettings} />
      <section className="jm-panel ges-card cal-section" aria-label="Interface">
        <label className="cal-knob">
          <span className="cal-knob-top">
            <span>Interface brightness</span>
            <output>{Math.round(ui.brightness * 100)}%</output>
          </span>
          <input type="range" aria-label="Interface brightness" aria-valuetext={`${Math.round(ui.brightness * 100)}%`} min={UI_LIMITS.brightness[0]} max={UI_LIMITS.brightness[1]} step={0.05} value={ui.brightness} onChange={(e) => ui.update({ brightness: Number(e.target.value) })} />
          <small>Dims HELL (handy at night) without changing the iPhone’s own brightness.</small>
        </label>
        <label className="cal-knob">
          <span className="cal-knob-top">
            <span>Glow intensity</span>
            <output>{Math.round(ui.glow * 100)}%</output>
          </span>
          <input type="range" aria-label="Glow intensity" aria-valuetext={`${Math.round(ui.glow * 100)}%`} min={UI_LIMITS.glow[0]} max={UI_LIMITS.glow[1]} step={0.1} value={ui.glow} onChange={(e) => ui.update({ glow: Number(e.target.value) })} />
          <small>The blue glow around panels and buttons. The orb has its own glow under Orb.</small>
        </label>
        <div className="set-field">
          <span id="set-anim" className="set-field-label">Animation intensity</span>
          <div role="radiogroup" aria-labelledby="set-anim" className="cal-choices">
            {(
              [
                ['full', 'Full'],
                ['calm', 'Calm'],
                ['off', 'Off'],
              ] as [AnimationLevel, string][]
            ).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={ui.animation === v} className="jm-icon-btn hell-choice" onClick={() => ui.update({ animation: v })}>
                {label}
              </button>
            ))}
          </div>
          <small className="set-small">
            {ui.animation === 'full' ? 'Everything moves.' : ui.animation === 'calm' ? 'Looping effects stop; the orb moves slowly. Saves battery.' : 'Nothing moves, the orb is drawn still. Saves the most battery.'}
          </small>
        </div>
        <button type="button" className="jm-icon-btn cal-wide" onClick={ui.reset}>
          <RotateCcw size={16} aria-hidden="true" /> Reset appearance
        </button>
      </section>
      <Row icon={<Boxes size={20} />} title="Hologram appearance" detail="Background, lighting and colors are set per hologram in the builder" onClick={() => navigate('/m/hologram')} />

      <h2 className="jm-label set-h">Voice</h2>
      <Row icon={<Mic size={20} />} title="Voice" detail="Voice, speaking speed, listening, wake phrase" onClick={() => navigate('/m/voice')} />
      <label className="jm-panel" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '8px 14px', borderRadius: 14, cursor: 'pointer' }}>
        <Volume2 size={20} style={{ color: 'var(--jm-cyan)' }} aria-hidden="true" />
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 15 }}>Spoken replies</span>
          <span style={{ fontSize: 12.5, color: 'var(--jm-text-3)' }}>HELL reads its answers aloud</span>
        </span>
        <input
          type="checkbox"
          className="hell-switch"
          checked={voiceOut}
          onChange={(e) => {
            updateSettings({ voiceOutputEnabled: e.target.checked, voiceAutoplay: e.target.checked });
            if (!e.target.checked) useTtsStore.getState().stop();
          }}
        />
      </label>

      <h2 className="jm-label set-h">Gestures</h2>
      <Row icon={<Crosshair size={20} />} title="Gesture sensitivity" detail="Training, sensitivity, handedness, assignments" onClick={() => navigate('/m/calibration')} />
      <Row icon={<Hand size={20} />} title="Gestures" detail="Touch gestures on/off, camera hand gestures" onClick={() => navigate('/m/gestures')} />

      <h2 className="jm-label set-h">Privacy &amp; permissions</h2>
      <Row icon={<Camera size={20} />} title={`Camera: ${PERM_TEXT[camPerm]}`} detail="Change in iPhone Settings › Safari › Camera. Test it in Diagnostics." onClick={() => navigate('/m/diagnostics')} />
      <Row icon={<Mic size={20} />} title={`Microphone: ${PERM_TEXT[micPerm]}`} detail="Change in iPhone Settings › Safari › Microphone." onClick={() => navigate('/m/diagnostics')} />
      <Row icon={<Brain size={20} />} title="Memory" detail="What HELL learns and uses; approve or delete memories" onClick={() => navigate('/m/memory')} />

      <h2 className="jm-label set-h">More</h2>
      <Row icon={<CloudSun size={20} />} title="Weather" detail={weatherDetail} onClick={() => setWeatherOpen(true)} />
      <Row icon={<Activity size={20} />} title="Diagnostics" detail="Check microphone, camera, AI, voice and more" onClick={() => navigate('/m/diagnostics')} />
      <Row icon={<Monitor size={20} />} title="Full settings" detail="Models, data sources, cloud keys (desktop layout)" href="/settings" />
      {authVia === 'cookie' && <Row icon={<LogOut size={20} />} title="Sign out of this device" onClick={() => void signOut()} />}

      <p style={{ fontSize: 12, color: 'var(--jm-text-3)', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        HELL · Phase 6 — built on OpenJarvis.
      </p>

      {weatherOpen && <WeatherSheet onClose={() => setWeatherOpen(false)} />}
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, CloudSun, LogOut, Mic, Monitor, Sparkles, Volume2 } from 'lucide-react';
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

/**
 * Mobile settings. A fuller customization center (voice selection, gesture
 * sensitivity, interface brightness) arrives with the later stages.
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

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 6 }}>Settings</h1>

      <Row icon={<Sparkles size={20} />} title="Orb appearance" detail="Color, particles, size, speed, glow" onClick={openOrbSettings} />
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

      <Row icon={<CloudSun size={20} />} title="Weather" detail={weatherDetail} onClick={() => setWeatherOpen(true)} />
      <Row icon={<Monitor size={20} />} title="Full settings" detail="Models, data sources, cloud keys (desktop layout)" href="/settings" />
      {authVia === 'cookie' && <Row icon={<LogOut size={20} />} title="Sign out of this device" onClick={() => void signOut()} />}

      <p style={{ fontSize: 12, color: 'var(--jm-text-3)', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        HELL · Phase 6 — built on OpenJarvis.
      </p>

      {weatherOpen && <WeatherSheet onClose={() => setWeatherOpen(false)} />}
    </div>
  );
}

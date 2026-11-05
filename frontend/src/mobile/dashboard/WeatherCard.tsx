import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  MapPin,
  Moon,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';
import { fetchWeather, locateOnce, useWeatherPrefs, type Weather } from '../../lib/weather-api';

const ICONS: Record<Weather['icon'], LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

const REFRESH_MS = 15 * 60 * 1000;

/** Dashboard weather tile. Off until the user opts in via the sheet. */
export function WeatherCard({ online, onOpenSetup }: { online: boolean | null; onOpenSetup: () => void }) {
  const { source, units } = useWeatherPrefs();
  const [weather, setWeather] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (source.kind === 'off') return;
    try {
      setWeather(await fetchWeather(source, units));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Weather unavailable');
    }
  }, [source, units]);

  useEffect(() => {
    setWeather(null);
    setError(null);
    if (source.kind === 'off' || online === false) return;
    void load();
    // Battery: refresh only while visible; catch up when HELL comes back.
    let last = Date.now();
    const refresh = () => {
      if (document.hidden) return;
      last = Date.now();
      void load();
    };
    const t = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last > REFRESH_MS) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, source.kind, online]);

  let body;
  if (source.kind === 'off') {
    body = (
      <>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CloudSun size={22} aria-hidden="true" style={{ color: 'var(--jm-cyan)' }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Weather</span>
        </span>
        <span className="hd-weather-sub">Tap to set up</span>
      </>
    );
  } else if (weather) {
    const Icon = !weather.is_day && weather.icon === 'clear' ? Moon : ICONS[weather.icon] ?? Cloud;
    body = (
      <>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={24} aria-hidden="true" style={{ color: '#ffd36b' }} />
          <span className="hd-weather-temp">
            {weather.temperature}°{weather.units.toUpperCase()}
          </span>
        </span>
        <span className="hd-weather-sub">{weather.label}</span>
      </>
    );
  } else {
    body = <span className="hd-weather-sub">{error ? 'Weather unavailable' : 'Loading…'}</span>;
  }

  const label = weather
    ? `Weather: ${weather.temperature} degrees, ${weather.label}${weather.place ? `, ${weather.place}` : ''}. Tap to change.`
    : source.kind === 'off'
      ? 'Set up weather'
      : `Weather: ${error ?? 'loading'}. Tap to change.`;

  return (
    <button type="button" className="hd-weather hd-chamfer" onClick={onOpenSetup} aria-label={label} title={error ?? undefined}>
      <span className="hd-chamfer-in" aria-hidden="true" />
      <span className="hd-weather-body">{body}</span>
    </button>
  );
}

/** Choose a city or the phone's location (rounded) for weather, or turn it off. */
export function WeatherSheet({ onClose }: { onClose: () => void }) {
  const { source, units, set } = useWeatherPrefs();
  const [city, setCity] = useState(source.kind === 'city' ? source.city : '');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const useLocation = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const pos = await locateOnce();
      set({ source: { kind: 'location', lat: pos.lat, lon: pos.lon } });
      onClose();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not get your location');
    } finally {
      setBusy(false);
    }
  };

  const useCity = () => {
    const c = city.trim();
    if (c.length < 2) {
      setStatus('Type a city name');
      return;
    }
    set({ source: { kind: 'city', city: c } });
    onClose();
  };

  return (
    <div className="hell-sheet-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="hd-weather-title" className="hell-sheet jm-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id="hd-weather-title" style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Weather</h2>
          <button ref={closeRef} type="button" className="jm-icon-btn" onClick={onClose} aria-label="Close weather settings">
            <X size={20} />
          </button>
        </div>

        <button type="button" className="jm-primary-btn" onClick={() => void useLocation()} disabled={busy}>
          <MapPin size={18} aria-hidden="true" /> {busy ? 'Locating…' : 'Use my location'}
        </button>

        <form
          style={{ display: 'flex', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            useCity();
          }}
        >
          <label className="sr-only" htmlFor="hd-city">City</label>
          <input id="hd-city" className="jm-field" placeholder="Or type a city" value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} enterKeyHint="done" />
          <button type="submit" className="jm-icon-btn" style={{ width: 'auto', padding: '0 14px' }}>Use</button>
        </form>

        <div role="radiogroup" aria-label="Temperature units" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(['f', 'c'] as const).map((u) => (
            <button key={u} type="button" role="radio" aria-checked={units === u} className="jm-icon-btn hell-choice" style={{ width: '100%' }} onClick={() => set({ units: u })}>
              {u === 'f' ? '°F' : '°C'}
            </button>
          ))}
        </div>

        {source.kind !== 'off' && (
          <button type="button" className="jm-icon-btn" style={{ width: '100%' }} onClick={() => { set({ source: { kind: 'off' } }); onClose(); }}>
            Turn weather off
          </button>
        )}

        <p role="status" style={{ minHeight: 18, fontSize: 13, color: 'var(--jm-danger)' }}>{status ?? ''}</p>
        <p style={{ fontSize: 12, color: 'var(--jm-text-3)', lineHeight: 1.5 }}>
          Your server looks up the weather with Open-Meteo, a free service. It sends only the city name, or your location rounded to about 1 km. Nothing is sent while weather is off.
        </p>
      </div>
    </div>
  );
}

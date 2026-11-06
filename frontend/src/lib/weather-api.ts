/**
 * Weather for the HELL dashboard, via the server's /v1/hell/weather proxy
 * (Open-Meteo). Off until the user chooses a city or "use my location";
 * the choice is saved on this device only.
 */
import { create } from 'zustand';
import { apiFetch } from './api';

export interface Weather {
  temperature: number;
  units: 'f' | 'c';
  code: number;
  label: string;
  icon: 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';
  is_day: boolean;
  place: string | null;
  updated_at: number;
}

export type WeatherSource =
  | { kind: 'off' }
  | { kind: 'city'; city: string }
  | { kind: 'location'; lat: number; lon: number };

export async function fetchWeather(source: Exclude<WeatherSource, { kind: 'off' }>, units: 'f' | 'c'): Promise<Weather> {
  const q = new URLSearchParams({ units });
  if (source.kind === 'city') q.set('city', source.city);
  else {
    // Round on the phone too: the exact position never leaves the device.
    q.set('lat', source.lat.toFixed(2));
    q.set('lon', source.lon.toFixed(2));
  }
  const res = await apiFetch(`/v1/hell/weather?${q}`);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Non-JSON error.
    }
    throw new Error(detail || `Weather unavailable (HTTP ${res.status})`);
  }
  const w = await res.json();
  if (!Number.isFinite(w?.temperature) || typeof w?.label !== 'string') throw new Error('Weather unavailable');
  return w as Weather;
}

/** Ask for the phone's location once (shows the iOS permission prompt). */
export function locateOnce(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not available on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        reject(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission was denied' : 'Could not get your location')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

// ---- Saved choice -----------------------------------------------------------

const KEY = 'hell-weather-v1';

export function sanitizeWeatherPrefs(raw: unknown): { source: WeatherSource; units: 'f' | 'c' } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const units = r.units === 'c' ? 'c' : 'f';
  const s = (r.source && typeof r.source === 'object' ? r.source : {}) as Record<string, unknown>;
  let source: WeatherSource = { kind: 'off' };
  if (s.kind === 'city' && typeof s.city === 'string' && s.city.trim().length >= 2) {
    source = { kind: 'city', city: s.city.trim().slice(0, 80) };
  } else if (
    s.kind === 'location'
    && typeof s.lat === 'number' && Math.abs(s.lat) <= 90
    && typeof s.lon === 'number' && Math.abs(s.lon) <= 180
  ) {
    source = { kind: 'location', lat: Math.round(s.lat * 100) / 100, lon: Math.round(s.lon * 100) / 100 };
  }
  return { source, units };
}

interface WeatherPrefsStore {
  source: WeatherSource;
  units: 'f' | 'c';
  set: (changes: Partial<{ source: WeatherSource; units: 'f' | 'c' }>) => void;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitizeWeatherPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeWeatherPrefs(null);
  }
}

export const useWeatherPrefs = create<WeatherPrefsStore>((set, get) => ({
  ...load(),
  set: (changes) => {
    const next = sanitizeWeatherPrefs({ source: get().source, units: get().units, ...changes });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Not saved; applies for this session.
    }
    set(next);
  },
}));

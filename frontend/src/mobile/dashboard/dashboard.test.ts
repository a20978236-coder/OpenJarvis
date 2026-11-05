import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODULES, moduleById, STAGE_NAMES } from './modules';
import { fitOrb } from './layout';
import { sanitizeWeatherPrefs } from '../../lib/weather-api';

describe('dashboard modules', () => {
  it('has the six left and six right modules from the design, in order', () => {
    expect(MODULES.filter((m) => m.side === 'left').map((m) => m.label)).toEqual([
      'Hologram Builder', 'Vision', 'Gestures', 'Calibration', 'Memory', 'Tasks',
    ]);
    expect(MODULES.filter((m) => m.side === 'right').map((m) => m.label)).toEqual([
      'Apps', 'Files', 'Notes', 'Diagnostics', 'Settings', 'AI Modules',
    ]);
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
  });

  it('ready modules open real screens; planned ones name a known stage', () => {
    for (const m of MODULES) {
      if (m.stage === null) expect(m.route).not.toMatch(/^\/m\/module\//);
      else {
        expect(m.route).toBe(`/m/module/${m.id}`);
        expect(STAGE_NAMES[m.stage]).toBeTruthy();
      }
    }
    expect(moduleById('nope')).toBeUndefined();
  });
});

describe('fitOrb', () => {
  it('fits between the columns and inside the height', () => {
    expect(fitOrb(373, 500, 116)).toBe(311); // iPhone 15: width-bound, runs behind columns
    expect(fitOrb(373, 250, 116)).toBe(240); // short stage: height-bound
    expect(fitOrb(0, 0, 116)).toBe(220); // before layout
    expect(fitOrb(250, 300, 140)).toBe(170); // never smaller than 170
    expect(fitOrb(1200, 900, 132)).toBe(380); // never larger than 380
  });
});

describe('weather prefs', () => {
  it('defaults to off and validates stored data', () => {
    expect(sanitizeWeatherPrefs(null)).toEqual({ source: { kind: 'off' }, units: 'f' });
    expect(sanitizeWeatherPrefs({ source: { kind: 'city', city: '  Leeds ' }, units: 'c' })).toEqual({
      source: { kind: 'city', city: 'Leeds' },
      units: 'c',
    });
    expect(sanitizeWeatherPrefs({ source: { kind: 'city', city: 'x' } }).source).toEqual({ kind: 'off' });
    expect(sanitizeWeatherPrefs({ source: { kind: 'location', lat: 200, lon: 0 } }).source).toEqual({ kind: 'off' });
  });

  it('stores location already rounded to ~1 km', () => {
    expect(sanitizeWeatherPrefs({ source: { kind: 'location', lat: 53.799712, lon: -1.549245 } }).source).toEqual({
      kind: 'location',
      lat: 53.8,
      lon: -1.55,
    });
  });
});

describe('fetchWeather', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '');
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
    (globalThis as unknown as { localStorage: { getItem: () => null; setItem: () => void } }).localStorage = {
      getItem: () => null,
      setItem: () => {},
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it('never sends exact coordinates', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ temperature: 70, label: 'Clear', icon: 'clear', units: 'f', is_day: true }), { status: 200 }));
    const { fetchWeather } = await import('../../lib/weather-api');
    await fetchWeather({ kind: 'location', lat: 53.799712, lon: -1.549245 }, 'f');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/v1/hell/weather?units=f&lat=53.80&lon=-1.55');
  });

  it('rejects a malformed reply instead of rendering garbage', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const { fetchWeather } = await import('../../lib/weather-api');
    await expect(fetchWeather({ kind: 'city', city: 'Leeds' }, 'c')).rejects.toThrow('Weather unavailable');
  });

  it("passes the server's error through", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Couldn't find 'Atlantis'" }), { status: 404 }));
    const { fetchWeather } = await import('../../lib/weather-api');
    await expect(fetchWeather({ kind: 'city', city: 'Atlantis' }, 'c')).rejects.toThrow("Couldn't find");
  });
});

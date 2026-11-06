import { describe, expect, it, vi } from 'vitest';
import { applyUi, DEFAULT_UI, sanitizeUi, UI_LIMITS } from './ui-prefs';

describe('interface preferences', () => {
  it('sanitizes and clamps', () => {
    expect(sanitizeUi(null)).toEqual(DEFAULT_UI);
    expect(sanitizeUi({ brightness: 0.1, glow: 9, animation: 'wild' })).toEqual({ brightness: UI_LIMITS.brightness[0], glow: UI_LIMITS.glow[1], animation: 'full' });
    expect(sanitizeUi({ brightness: 0.7, animation: 'calm' })).toMatchObject({ brightness: 0.7, animation: 'calm' });
  });

  it('applies as CSS variables and a data attribute', () => {
    const style = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => style.set(k, v) }, dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyUi({ brightness: 0.6, glow: 1.4, animation: 'off' }, root);
    expect(style.get('--hell-dim')).toBe('0.4');
    expect(style.get('--hell-glow')).toBe('1.4');
    expect((root as unknown as { dataset: Record<string, string> }).dataset.anim).toBe('off');
  });

  it('motion stops for the iOS setting or HELL’s own "off"', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const mod = await import('./ui-prefs');
    mod.useUiPrefs.setState({ animation: 'full' });
    expect(mod.motionOff()).toBe(false);
    mod.useUiPrefs.setState({ animation: 'off' });
    expect(mod.motionOff()).toBe(true);
    mod.useUiPrefs.setState({ animation: 'full' });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(mod.motionOff()).toBe(true);
    vi.unstubAllGlobals();
  });
});

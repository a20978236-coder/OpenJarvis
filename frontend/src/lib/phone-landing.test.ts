import { describe, expect, it } from 'vitest';
import { phoneLanding } from './phone-landing';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('phoneLanding', () => {
  it('sends a phone that opens the bare address to HELL', () => {
    expect(phoneLanding('/', '', IPHONE)).toBe('/m');
    expect(phoneLanding('/', '', ANDROID)).toBe('/m');
  });

  it('leaves desktops and tablets on the desktop layout', () => {
    expect(phoneLanding('/', '', DESKTOP)).toBeNull();
    expect(phoneLanding('/', '', IPAD)).toBeNull();
  });

  it('only redirects the bare address', () => {
    expect(phoneLanding('/m', '', IPHONE)).toBeNull();
    expect(phoneLanding('/m/chat', '', IPHONE)).toBeNull();
    expect(phoneLanding('/settings', '', IPHONE)).toBeNull();
    expect(phoneLanding('/dashboard', '', IPHONE)).toBeNull();
  });

  it('lets a phone ask for the desktop layout', () => {
    expect(phoneLanding('/', '?desktop=1', IPHONE)).toBeNull();
    expect(phoneLanding('/', '?desktop', IPHONE)).toBeNull();
  });
});

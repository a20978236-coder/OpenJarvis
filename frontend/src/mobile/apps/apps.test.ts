import { describe, expect, it } from 'vitest';
import { matchShortcutCommand, sanitizeShortcuts, shortcutUrl, type ShortcutButton } from './shortcuts';
import { formatBytes } from '../../lib/files-api';
import { MODULES } from '../dashboard/modules';

const buttons: ShortcutButton[] = [
  { id: '1', label: 'Lights off', shortcut: 'Lights Off', input: '' },
  { id: '2', label: 'Note', shortcut: 'Quick Note', input: 'from HELL' },
];

describe('iOS Shortcuts buttons', () => {
  it('builds the run-shortcut URL, with optional text input', () => {
    expect(shortcutUrl(buttons[0])).toBe('shortcuts://run-shortcut?name=Lights%20Off');
    expect(shortcutUrl(buttons[1])).toBe('shortcuts://run-shortcut?name=Quick%20Note&input=text&text=from%20HELL');
    expect(shortcutUrl({ shortcut: 'A&B', input: '' }, 'x=1')).toBe('shortcuts://run-shortcut?name=A%26B&input=text&text=x%3D1');
  });

  it('matches spoken commands only to saved shortcuts', () => {
    expect(matchShortcutCommand('Run shortcut lights off', buttons)?.id).toBe('1');
    expect(matchShortcutCommand('hey hell, please start the shortcut called "Quick Note".', buttons)?.id).toBe('2');
    expect(matchShortcutCommand('run shortcut Delete Everything', buttons)).toBeNull();
    expect(matchShortcutCommand('turn the lights off', buttons)).toBeNull();
  });

  it('sanitizes stored buttons', () => {
    const s = sanitizeShortcuts([{ shortcut: '  Morning  ' }, { label: 'no name' }, null, 'x']);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ shortcut: 'Morning', label: 'Morning', input: '' });
    expect(sanitizeShortcuts('nope')).toEqual([]);
  });
});

describe('files & modules', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('every dashboard module now opens a working screen', () => {
    expect(MODULES.filter((m) => m.stage !== null).map((m) => m.id)).toEqual([]);
  });
});

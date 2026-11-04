import { describe, expect, it } from 'vitest';
import { extensionForMimeType, pickRecordingMimeType, recordingFilename } from './audio-format';

describe('extensionForMimeType', () => {
  it('names Safari/iPhone MP4 recordings m4a', () => {
    expect(extensionForMimeType('audio/mp4')).toBe('m4a');
    expect(extensionForMimeType('audio/mp4;codecs=mp4a.40.2')).toBe('m4a');
    expect(extensionForMimeType('audio/aac')).toBe('m4a');
  });

  it('keeps WebM for Chrome/Firefox recordings', () => {
    expect(extensionForMimeType('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionForMimeType('audio/webm')).toBe('webm');
  });

  it('maps other common types', () => {
    expect(extensionForMimeType('audio/ogg;codecs=opus')).toBe('ogg');
    expect(extensionForMimeType('audio/wav')).toBe('wav');
    expect(extensionForMimeType('audio/mpeg')).toBe('mp3');
  });

  it('falls back to webm for empty or unknown types', () => {
    expect(extensionForMimeType('')).toBe('webm');
    expect(extensionForMimeType(undefined)).toBe('webm');
    expect(extensionForMimeType('application/octet-stream')).toBe('webm');
  });

  it('is case-insensitive', () => {
    expect(extensionForMimeType('Audio/MP4')).toBe('m4a');
  });
});

describe('recordingFilename', () => {
  it('builds the upload name from the recorded type', () => {
    expect(recordingFilename('audio/mp4')).toBe('recording.m4a');
    expect(recordingFilename('audio/webm')).toBe('recording.webm');
  });
});

describe('pickRecordingMimeType', () => {
  it('prefers WebM/Opus where supported (Chrome)', () => {
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('picks MP4 on iPhone Safari, which has no WebM recording', () => {
    expect(pickRecordingMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
  });

  it('lets the browser choose when nothing matches or the API is missing', () => {
    expect(pickRecordingMimeType(() => false)).toBeUndefined();
    expect(pickRecordingMimeType(undefined)).toBeUndefined();
  });

  it('treats a throwing probe as unsupported', () => {
    expect(
      pickRecordingMimeType((t) => {
        if (t.startsWith('audio/webm')) throw new Error('boom');
        return t === 'audio/mp4';
      }),
    ).toBe('audio/mp4');
  });
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceRecognitionSupported, recognizeOnce } from '../lib/device-speech';
import { pickInputEngine, useVoicePrefs } from '../lib/voice-prefs';
import { useSpeech, type SpeechState } from './useSpeech';

/**
 * Voice input for the mobile app: the HELL server's transcriber when it is
 * available, otherwise (only if you allowed it) the device's own speech
 * recognition. Same shape as `useSpeech`, so callers don't care which.
 */
export function useVoiceInput() {
  const server = useSpeech();
  const prefs = useVoicePrefs();
  const deviceOk = deviceRecognitionSupported();
  const engine = pickInputEngine(prefs.input, server.available, deviceOk, prefs.allowDeviceRecognition);

  const [deviceState, setDeviceState] = useState<SpeechState>('idle');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [interim, setInterim] = useState('');
  const session = useRef<ReturnType<typeof recognizeOnce> | null>(null);

  useEffect(() => () => session.current?.abort(), []);

  const startRecording = useCallback(async () => {
    if (engine !== 'device') return server.startRecording();
    setDeviceError(null);
    setInterim('');
    const s = recognizeOnce(setInterim);
    session.current = s;
    setDeviceState('recording');
    // The device recogniser ends by itself when you pause.
    s.result
      .catch((e: unknown) => setDeviceError(e instanceof Error ? e.message : 'Speech recognition failed'))
      .finally(() => {
        if (session.current === s) setDeviceState((st) => (st === 'recording' ? 'idle' : st));
      });
  }, [engine, server]);

  const stopRecording = useCallback(async (): Promise<string> => {
    const s = session.current;
    if (engine !== 'device' || !s) return server.stopRecording();
    setDeviceState('transcribing');
    s.stop();
    try {
      return await s.result;
    } finally {
      session.current = null;
      setDeviceState('idle');
    }
  }, [engine, server]);

  const cancelRecording = useCallback(() => {
    if (engine !== 'device') return server.cancelRecording();
    session.current?.abort();
    session.current = null;
    setDeviceState('idle');
  }, [engine, server]);

  /** A pending device result (ended by itself): resolves with its text. */
  const pendingResult = useCallback(() => session.current?.result ?? null, []);

  const device = engine === 'device';
  return {
    engine,
    state: device ? deviceState : server.state,
    error: device ? deviceError : server.error,
    available: engine !== null,
    serverAvailable: server.available,
    interim: device ? interim : '',
    startRecording,
    stopRecording,
    cancelRecording,
    pendingResult,
    /** Mic level (server engine only; the device recogniser owns the mic). */
    getLevel: device ? () => null : server.getLevel,
  };
}

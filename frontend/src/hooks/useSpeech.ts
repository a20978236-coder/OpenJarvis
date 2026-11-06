import { useState, useCallback, useRef, useEffect } from 'react';
import { transcribeAudio, fetchSpeechHealth } from '../lib/api';
import { pickRecordingMimeType, recordingFilename } from '../lib/audio-format';
import { meterStream } from '../lib/audio-level';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

export function useSpeech() {
  const [state, setState] = useState<SpeechState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<ReturnType<typeof meterStream> | null>(null);
  const closeMeter = () => {
    meterRef.current?.close();
    meterRef.current = null;
  };

  // Check if speech backend is available on mount
  useEffect(() => {
    fetchSpeechHealth()
      .then((health) => setAvailable(health.available))
      .catch(() => setAvailable(false));
  }, []);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone not supported in this browser');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Mic level for the orb and for stopping when you pause.
      meterRef.current = meterStream(stream);

      // Ask for an explicit container so the upload can be named after it;
      // iPhone Safari only records MP4, Chrome/Firefox prefer WebM.
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setState('recording');
    } catch (err) {
      setError('Microphone access denied');
      setState('idle');
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') {
        reject(new Error('Not recording'));
        return;
      }

      recorder.onstop = async () => {
        setState('transcribing');

        // Stop all audio tracks
        closeMeter();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        // Prefer the recorder's reported type, then the chunks' own type;
        // only fall back to WebM when the browser reports neither.
        const recordedType = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: recordedType });
        chunksRef.current = [];

        try {
          const result = await transcribeAudio(blob, recordingFilename(recordedType));
          setState('idle');
          resolve(result.text);
        } catch (err) {
          setState('idle');
          const msg = err instanceof Error ? err.message : 'Transcription failed';
          setError(msg);
          reject(err);
        }
      };

      recorder.stop();
    });
  }, []);

  /** Stop recording and throw the audio away (nothing is transcribed or sent). */
  const cancelRecording = useCallback((): void => {
    const recorder = mediaRecorderRef.current;
    const finish = () => {
      closeMeter();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      chunksRef.current = [];
      setState('idle');
    };
    if (!recorder || recorder.state !== 'recording') {
      finish();
      return;
    }
    recorder.onstop = finish;
    recorder.ondataavailable = null;
    recorder.stop();
  }, []);

  /** Live microphone level 0..1 while recording (null if it can't be read). */
  const getLevel = useCallback((): number | null => meterRef.current?.level() ?? null, []);

  return {
    state,
    error,
    available,
    startRecording,
    stopRecording,
    cancelRecording,
    getLevel,
    isRecording: state === 'recording',
    isTranscribing: state === 'transcribing',
  };
}

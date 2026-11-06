import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, Mic, Play, Square, Volume2 } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useTtsStore } from '../../lib/tts';
import { fetchSpeechHealth, fetchTtsVoices, type TtsVoices } from '../../lib/api';
import { deviceRecognitionSupported, deviceVoicesSupported, loadDeviceVoices, type DeviceVoice } from '../../lib/device-speech';
import { RATE_LIMITS, useVoicePrefs, type InputEngine, type OutputEngine } from '../../lib/voice-prefs';
import { prettyServerVoice } from './voice-names';
import '../gestures/gestures.css';

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, boolean?][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="cal-choices">
      {options.map(([v, text, disabled]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} className="jm-icon-btn hell-choice" onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * Voice settings: how HELL speaks (engine, voice, speed), how it listens,
 * hands-free conversation and the wake phrase. Saved on this device.
 */
export function VoiceSettings() {
  const navigate = useNavigate();
  const prefs = useVoicePrefs();
  const voiceOut = useAppStore((s) => s.settings.voiceOutputEnabled && s.settings.voiceAutoplay);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const tts = useTtsStore();
  const [server, setServer] = useState<TtsVoices | null>(null);
  const [stt, setStt] = useState<{ available: boolean; backend?: string } | null>(null);
  const [device, setDevice] = useState<DeviceVoice[]>([]);
  const deviceVoices = deviceVoicesSupported();
  const deviceRec = deviceRecognitionSupported();

  useEffect(() => {
    void fetchTtsVoices().then(setServer);
    void fetchSpeechHealth().then((h) => setStt({ available: h.available, backend: (h as { backend?: string }).backend })).catch(() => setStt({ available: false }));
    void loadDeviceVoices().then(setDevice);
  }, []);

  const serverOk = server?.available === true;
  const outEngine = prefs.output === 'server' || (prefs.output === 'auto' && serverOk) ? 'server' : 'device';
  const previewing = tts.speakingId === 'voice-preview' && tts.state !== 'idle';
  const preview = () => {
    if (previewing) return useTtsStore.getState().stop();
    // The preview always uses the current choices (not a cached probe).
    useTtsStore.setState({ serverAvailable: serverOk, available: serverOk || deviceVoices });
    void useTtsStore.getState().speak('voice-preview', "Hello, I'm HELL. This is how I sound at this speed.");
  };

  const status = (ok: boolean | undefined, yes: string, no: string) => (
    <span className="voice-status" data-ok={ok || undefined}>
      <span aria-hidden="true">●</span> {ok ? yes : no}
    </span>
  );

  return (
    <div className="jm-scroll ges">
      <button type="button" onClick={() => navigate('/m/settings')} className="jm-icon-btn ges-back">
        <ChevronLeft size={20} aria-hidden="true" /> Settings
      </button>
      <header className="ges-head">
        <Volume2 size={32} strokeWidth={1.6} aria-hidden="true" />
        <h1>Voice</h1>
      </header>

      <section className="jm-panel ges-card cal-section" aria-labelledby="v-engine">
        <h2 id="v-engine" className="cal-h">Voice engine status</h2>
        {status(serverOk, `HELL server voice: ${server?.backend ?? 'on'}`, 'HELL server voice: not installed')}
        {status(deviceVoices, `iPhone voices: ${device.length || 'available'}`, 'Device voices: not supported in this browser')}
        {status(stt?.available, `HELL server transcriber: ${stt?.backend ?? 'on'}`, 'HELL server transcriber: not installed')}
        {status(deviceRec, 'Device speech recognition: supported', 'Device speech recognition: not supported here')}
      </section>

      <section className="jm-panel ges-card cal-section" aria-labelledby="v-out">
        <h2 id="v-out" className="cal-h">How HELL speaks</h2>
        <label className="holo-toggle">
          <input type="checkbox" className="hell-switch" checked={voiceOut} onChange={(e) => updateSettings({ voiceOutputEnabled: e.target.checked, voiceAutoplay: e.target.checked })} />
          <span>Speak replies aloud</span>
        </label>
        <Choice<OutputEngine>
          label="Speaking engine"
          value={prefs.output}
          onChange={(output) => prefs.update({ output })}
          options={[
            ['auto', 'Automatic'],
            ['server', 'HELL server', !serverOk],
            ['device', 'iPhone voice', !deviceVoices],
          ]}
        />
        <p className="cal-p">
          {outEngine === 'server'
            ? 'Your HELL server makes the voice (free and local). HELL’s particles follow the real volume of its voice.'
            : 'Your iPhone’s own voice, made on the phone. iOS doesn’t share that audio, so the particles pulse on each word instead.'}
        </p>
        {outEngine === 'server' ? (
          <label className="cal-assign">
            <span>Voice</span>
            <select className="jm-field" value={prefs.serverVoice} onChange={(e) => prefs.update({ serverVoice: e.target.value })} disabled={!serverOk}>
              <option value="">Default{server?.default_voice ? ` — ${prettyServerVoice(server.default_voice)}` : ''}</option>
              {(server?.voices ?? []).map((v) => (
                <option key={v} value={v}>{prettyServerVoice(v)}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="cal-assign">
            <span>Voice</span>
            <select className="jm-field" value={prefs.deviceVoice} onChange={(e) => prefs.update({ deviceVoice: e.target.value })} disabled={!deviceVoices}>
              <option value="">System default</option>
              {device.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} ({v.lang}){v.local ? '' : ' · online'}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="cal-knob">
          <span className="cal-knob-top">
            <span>Speaking speed</span>
            <output>{prefs.rate.toFixed(2)}×</output>
          </span>
          <input type="range" aria-label="Speaking speed" aria-valuetext={`${prefs.rate.toFixed(2)} times`} min={RATE_LIMITS[0]} max={RATE_LIMITS[1]} step={0.05} value={prefs.rate} onChange={(e) => prefs.update({ rate: Number(e.target.value) })} />
        </label>
        <button type="button" className="jm-primary-btn" onClick={preview} disabled={!serverOk && !deviceVoices}>
          {previewing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} {previewing ? 'Stop' : 'Preview voice'}
        </button>
        {tts.errorId === 'voice-preview' && tts.error && <p className="voice-error" role="alert">{tts.error}</p>}
      </section>

      <section className="jm-panel ges-card cal-section" aria-labelledby="v-in">
        <h2 id="v-in" className="cal-h">How HELL listens</h2>
        <label className="holo-toggle">
          <input
            type="checkbox"
            className="hell-switch"
            checked={prefs.allowDeviceRecognition}
            disabled={!deviceRec}
            onChange={(e) => prefs.update({ allowDeviceRecognition: e.target.checked })}
          />
          <span>Allow iPhone speech recognition</span>
        </label>
        <p className="cal-p">
          Off by default. When on, HELL can use your iPhone&apos;s dictation when the server has no transcriber, and for the wake phrase. Apple may process that audio on its
          servers. With it off, your voice only goes to your own HELL server.
        </p>
        <Choice<InputEngine>
          label="Listening engine"
          value={prefs.input}
          onChange={(input) => prefs.update({ input })}
          options={[
            ['auto', 'Automatic'],
            ['server', 'HELL server', !stt?.available],
            ['device', 'iPhone', !deviceRec || !prefs.allowDeviceRecognition],
          ]}
        />
        <label className="holo-toggle">
          <input type="checkbox" className="hell-switch" checked={prefs.autoStop} onChange={(e) => prefs.update({ autoStop: e.target.checked })} />
          <span>Stop listening when I pause</span>
        </label>
        <label className="holo-toggle">
          <input type="checkbox" className="hell-switch" checked={prefs.continueConversation} onChange={(e) => prefs.update({ continueConversation: e.target.checked })} />
          <span>Continue the conversation</span>
        </label>
        <p className="cal-p">After answering a spoken question, HELL listens again for a follow-up. Say nothing and it stops. To interrupt HELL while it speaks, tap the mic, double tap, or show an open palm.</p>
      </section>

      <section className="jm-panel ges-card cal-section" aria-labelledby="v-wake">
        <h2 id="v-wake" className="cal-h">Wake phrase</h2>
        <label className="holo-toggle">
          <input
            type="checkbox"
            className="hell-switch"
            checked={prefs.wakePhrase}
            disabled={!deviceRec || !prefs.allowDeviceRecognition}
            onChange={(e) => prefs.update({ wakePhrase: e.target.checked })}
          />
          <span className="voice-inline">
            <Mic size={15} aria-hidden="true" /> Listen for “Hey HELL”
          </span>
        </label>
        <p className="cal-p">
          {!deviceRec
            ? 'Not available: this browser has no speech recognition.'
            : !prefs.allowDeviceRecognition
              ? 'Needs iPhone speech recognition (above).'
              : 'Works only while HELL is open on screen. iOS does not let web apps listen in the background or when the phone is locked, so it stops then. The microphone indicator stays on while it listens.'}
        </p>
      </section>
    </div>
  );
}

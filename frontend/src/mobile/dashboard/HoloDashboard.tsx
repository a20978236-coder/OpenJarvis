import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Boxes, Camera, ChevronUp, Keyboard, Mic, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useTtsStore } from '../../lib/tts';
import { getPersonalSummary } from '../../lib/personal-api';
import { useChatSender } from '../../hooks/useChatSender';
import { HellOrb } from '../HellOrb';
import { HellWordmark } from '../HellWordmark';
import { useMobile } from '../MobileShell';
import { MODULES, type HellModule } from './modules';
import { fitOrb } from './layout';
import { useGestures } from '../gestures/gesture-settings';
import { WeatherCard, WeatherSheet } from './WeatherCard';
import './dashboard.css';

// ---------------------------------------------------------------------------
// Small hooks
// ---------------------------------------------------------------------------

/** Current time, re-rendered on each minute boundary (not every second). */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(t);
  }, []);
  return now;
}

function useInternet(): boolean {
  const [on, setOn] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}


// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function ModuleButton({ m, badge, onOpen }: { m: HellModule; badge?: number; onOpen: () => void }) {
  const Icon = m.icon;
  const planned = m.stage !== null;
  return (
    <button
      type="button"
      className={`hd-module hd-chamfer hd-${m.side}`}
      data-planned={planned || undefined}
      onClick={onOpen}
      aria-label={planned ? `${m.label} — coming in stage ${m.stage}` : badge ? `${m.label}, ${badge} due` : m.label}
    >
      <span className="hd-chamfer-in" aria-hidden="true" />
      <Icon className="hd-module-icon" size={20} strokeWidth={1.7} aria-hidden="true" />
      <span className="hd-module-label">{m.label}</span>
      {planned && <span className="hd-stagetag" aria-hidden="true">{m.stage}</span>}
      {!planned && badge ? <span className="hd-badge" aria-hidden="true">{badge}</span> : null}
    </button>
  );
}

const STATUS_TEXT: Record<string, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  vision: 'Scanning…',
  error: 'Something went wrong',
  activating: 'HELL online',
  offline: 'Offline',
};

function Waveform({ active, side }: { active: boolean; side: 'l' | 'r' }) {
  // 14 bars; heights are fixed per bar so the idle look is stable, and the
  // animation (CSS) only runs while listening or speaking.
  const bars = side === 'l' ? [3, 5, 8, 6, 11, 7, 14, 9, 12, 6, 10, 5, 8, 4] : [4, 8, 5, 10, 6, 12, 9, 14, 7, 11, 6, 8, 5, 3];
  return (
    <span className="hd-wave" data-active={active || undefined} aria-hidden="true">
      {bars.map((h, i) => (
        <span key={i} style={{ height: h * 1.4, animationDelay: `${(i * 73) % 600}ms` }} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function HoloDashboard() {
  const navigate = useNavigate();
  const {
    online,
    orbState,
    speechAvailable,
    speechState,
    toggleTalk,
    activate,
    openOrbSettings,
    serverLatencyMs,
  } = useMobile();
  const { send } = useChatSender();
  const now = useClock();
  const internet = useInternet();
  const [stageRef, stage] = useSize<HTMLDivElement>();
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const composeRef = useRef<HTMLInputElement>(null);
  const [due, setDue] = useState<number | undefined>(undefined);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const voiceOut = useAppStore((s) => s.settings.voiceOutputEnabled && s.settings.voiceAutoplay);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const minimized = useGestures((s) => s.dashView === 'minimized');

  useEffect(() => {
    if (!online) return;
    getPersonalSummary()
      .then((s) => setDue(Number.isFinite(s?.due_today) && s.due_today > 0 ? s.due_today : undefined))
      .catch(() => setDue(undefined));
  }, [online]);

  const colW = Math.max(106, Math.min(132, Math.round(stage.w * 0.31)));
  const orbSize = fitOrb(stage.w, stage.h, minimized ? 40 : colW);
  // Spread the six buttons per side over the stage height (as in the
  // design) on tall screens; compact on short ones.
  const btnH = Math.max(44, Math.min(62, Math.floor((stage.h * 0.9 - 5 * 10) / 6)));
  const colStyle = { width: colW, height: Math.min(stage.h * 0.94, 6 * btnH + 5 * 14), ['--btn-h' as string]: `${btnH}px` };
  const canTalk = speechAvailable && online !== false;
  const recording = speechState === 'recording';

  const openModule = (m: HellModule) => navigate(m.route);

  const openCompose = () => {
    setComposeOpen(true);
    // Focus inside the tap handler: iOS only raises the keyboard for a
    // focus that happens during the user's gesture.
    composeRef.current?.focus();
  };

  const submitCompose = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setComposeOpen(false);
    navigate('/m/chat');
    await send(text);
  };

  const left = MODULES.filter((m) => m.side === 'left');
  const right = MODULES.filter((m) => m.side === 'right');
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const [clock, meridiem] = (() => {
    const m = time.match(/^(.*?)\s?([AP]M)$/i);
    return m ? [m[1], m[2]] : [time, ''];
  })();
  const date = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const serverLabel =
    online === null ? 'Connecting' : online ? (serverLatencyMs != null ? `${serverLatencyMs} ms` : 'Online') : 'Offline';

  return (
    <div className="hd" data-view={minimized ? 'minimized' : undefined}>
      <div className="hd-circuit" aria-hidden="true" />

      {/* -- Top: clock · HELL · status ------------------------------------ */}
      <header className="hd-top">
        <div className="hd-clock">
          <time dateTime={now.toISOString()} className="hd-time">
            {clock}
            {meridiem && <span className="hd-meridiem">{meridiem}</span>}
          </time>
          <span className="hd-date">{date}</span>
        </div>
        <div className="hd-brand hd-brand-frame">
          <HellWordmark />
        </div>
        <div className="hd-status" role="group" aria-label="Status">
          <span className="hd-chip" data-state={online === null ? 'pending' : online ? 'ok' : 'bad'} role="status" aria-label={`HELL server: ${serverLabel}`}>
            <span className="hd-dot" aria-hidden="true" /> Server <b>{serverLabel}</b>
          </span>
          <span className="hd-chip" data-state={internet ? 'ok' : 'bad'} role="status" aria-label={internet ? 'Internet connected' : 'No internet'}>
            <span className="hd-dot" aria-hidden="true" /> Net <b>{internet ? 'On' : 'Off'}</b>
          </span>
          <button
            type="button"
            className="hd-chip hd-chip-btn"
            onClick={() => {
              const next = !voiceOut;
              updateSettings({ voiceOutputEnabled: next, voiceAutoplay: next });
              if (!next) useTtsStore.getState().stop();
            }}
            aria-pressed={voiceOut}
            aria-label={voiceOut ? 'Spoken replies on' : 'Spoken replies off'}
          >
            {voiceOut ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
            Voice <b>{voiceOut ? 'On' : 'Off'}</b>
          </button>
        </div>
      </header>

      {/* -- Stage: modules around the orb --------------------------------- */}
      <div className="hd-stage" ref={stageRef}>
        <nav className="hd-col hd-col-left" aria-label="Modules, left" style={colStyle}>
          {left.map((m) => (
            <ModuleButton key={m.id} m={m} badge={m.id === 'tasks' ? due : undefined} onOpen={() => openModule(m)} />
          ))}
        </nav>
        <div className="hd-orb">
          <HellOrb
            state={orbState}
            size={orbSize}
            showBase
            showCaption={false}
            onTap={() => (orbState === 'listening' ? void toggleTalk() : activate())}
            onDoubleTap={canTalk ? () => void toggleTalk() : () => navigate('/m/chat')}
            onLongPress={openOrbSettings}
          />
        </div>
        <nav className="hd-col hd-col-right" aria-label="Modules, right" style={colStyle}>
          {right.map((m) => (
            <ModuleButton key={m.id} m={m} onOpen={() => openModule(m)} />
          ))}
        </nav>
      </div>

      {minimized && (
        <button type="button" className="hd-restore jm-primary-btn" onClick={() => useGestures.getState().setDashView('full')} aria-label="Restore the dashboard">
          <ChevronUp size={20} aria-hidden="true" /> Show HELL
        </button>
      )}

      {/* -- Listening status ---------------------------------------------- */}
      <div className="hd-listen hd-chamfer" role="status" aria-live="polite">
        <span className="hd-chamfer-in" aria-hidden="true" />
        <Waveform side="l" active={orbState === 'listening' || orbState === 'speaking'} />
        <span className="hd-listen-text">
          <Mic size={18} aria-hidden="true" />
          {STATUS_TEXT[orbState] ?? 'Ready'}
        </span>
        <Waveform side="r" active={orbState === 'listening' || orbState === 'speaking'} />
      </div>

      {/* -- Typed message (keyboard button) ------------------------------- */}
      <form
        className="hd-compose"
        data-open={composeOpen || undefined}
        aria-hidden={!composeOpen}
        onSubmit={(e) => {
          e.preventDefault();
          void submitCompose();
        }}
      >
        <label className="sr-only" htmlFor="hd-compose-input">Message HELL</label>
        <input
          id="hd-compose-input"
          ref={composeRef}
          className="jm-field"
          placeholder={selectedModel ? 'Message HELL' : 'No model available'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => !draft && setComposeOpen(false)}
          tabIndex={composeOpen ? 0 : -1}
          enterKeyHint="send"
        />
        <button type="submit" className="jm-primary-btn" style={{ width: 44, padding: 0, flexShrink: 0 }} disabled={!draft.trim()} aria-label="Send" tabIndex={composeOpen ? 0 : -1}>
          <Send size={18} />
        </button>
        <button type="button" className="jm-icon-btn" onClick={() => { setDraft(''); setComposeOpen(false); }} aria-label="Close message box" tabIndex={composeOpen ? 0 : -1}>
          <X size={18} />
        </button>
      </form>

      {/* -- Dock ---------------------------------------------------------- */}
      <div className="hd-dock">
        <WeatherCard online={online} onOpenSetup={() => setWeatherOpen(true)} />
        <button type="button" className="hd-dock-btn hd-chamfer" onClick={openCompose} aria-label="Type a message">
          <span className="hd-chamfer-in" aria-hidden="true" />
          <Keyboard size={24} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="hd-mic"
          data-recording={recording || undefined}
          onClick={() => (canTalk ? void toggleTalk() : navigate('/m/chat'))}
          disabled={speechState === 'transcribing'}
          aria-pressed={recording}
          aria-label={!canTalk ? 'Voice unavailable — open chat' : recording ? 'Stop and send' : 'Talk to HELL'}
        >
          {recording ? <Square size={26} fill="currentColor" aria-hidden="true" /> : <Mic size={30} aria-hidden="true" />}
        </button>
        <button type="button" className="hd-dock-btn hd-chamfer" onClick={() => navigate('/m/vision')} aria-label="Vision camera">
          <span className="hd-chamfer-in" aria-hidden="true" />
          <Camera size={24} aria-hidden="true" />
        </button>
        <button type="button" className="hd-holo hd-chamfer" onClick={() => navigate('/m/hologram')} aria-label="Hologram Builder">
          <span className="hd-chamfer-in" aria-hidden="true" />
          <Boxes size={30} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </div>

      {weatherOpen && <WeatherSheet onClose={() => setWeatherOpen(false)} />}
    </div>
  );
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Brain, CheckSquare, Home, MessageCircle, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../lib/store';
import { checkHealth, fetchModels, fetchServerInfo } from '../lib/api';
import { getSessionStatus, signOut as endSession, UNAUTHORIZED_EVENT } from '../lib/session-api';
import { useTtsStore } from '../lib/tts';
import { useSpeech, type SpeechState } from '../hooks/useSpeech';
import { useChatSender } from '../hooks/useChatSender';
import { useAutoSpeakReplies } from '../hooks/useAutoSpeakReplies';
import { deriveOrbState } from './orb-state';
import type { OrbState } from './orb-types';
import { MobileSignIn } from './MobileSignIn';
import './mobile.css';
import { HellWordmark } from './HellWordmark';
import { OrbCustomizer } from './OrbCustomizer';
import { HellOrb } from './HellOrb';

/**
 * One voice pipeline for the whole mobile app: the orb on Home and the mic in
 * Chat drive the same recorder, so "listening" never shows in one place while
 * another is recording.
 */
interface MobileContextValue {
  online: boolean | null;
  /** Round-trip time of the last health check, in ms. */
  serverLatencyMs: number | null;
  orbState: OrbState;
  speechState: SpeechState;
  speechAvailable: boolean;
  /** Tap-to-talk: start recording, or stop and send what was heard. */
  toggleTalk: () => Promise<void>;
  /** Start recording for dictation into a field (see `dictate`). */
  listen: () => Promise<void>;
  /** Stop a recording and return the transcript without sending it. */
  dictate: () => Promise<string | null>;
  /** Scatter-and-reform burst: "HELL online". */
  activate: () => void;
  /** Flash the orb red briefly. */
  flashError: () => void;
  /** Open the orb appearance sheet (long-press on the orb). */
  openOrbSettings: () => void;
  /** How this browser is signed in: a session cookie, an API key, or not needed. */
  authVia: 'cookie' | 'bearer' | null;
  signOut: () => Promise<void>;
}

const MobileContext = createContext<MobileContextValue | null>(null);

export function useMobile(): MobileContextValue {
  const ctx = useContext(MobileContext);
  if (!ctx) throw new Error('useMobile must be used inside <MobileShell>');
  return ctx;
}

const DEFAULTS_FLAG = 'jarvis-mobile-defaults-v1';

/** Voice is the point of the phone app: switch it on the first time only. */
function applyMobileDefaultsOnce(update: (s: { speechEnabled: boolean; voiceOutputEnabled: boolean; voiceAutoplay: boolean }) => void) {
  try {
    if (localStorage.getItem(DEFAULTS_FLAG)) return;
    update({ speechEnabled: true, voiceOutputEnabled: true, voiceAutoplay: true });
    localStorage.setItem(DEFAULTS_FLAG, '1');
  } catch {
    // Storage unavailable (private mode): leave settings as they are.
  }
}

const TABS = [
  { to: '/m', label: 'HELL', icon: Home, end: true },
  { to: '/m/chat', label: 'Chat', icon: MessageCircle, end: false },
  { to: '/m/memory', label: 'Memory', icon: Brain, end: false },
  { to: '/m/tasks', label: 'Tasks', icon: CheckSquare, end: false },
] as const;

type AuthState = 'checking' | 'signed-in' | 'signed-out';

/**
 * Sign-in gate. The app below only mounts once the browser is signed in (or
 * the server needs no sign-in), so its health probes and data loads never
 * run unauthenticated.
 */
export function MobileShell() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [via, setVia] = useState<'cookie' | 'bearer' | null>(null);
  const setModels = useAppStore((s) => s.setModels);
  const setModelsLoading = useAppStore((s) => s.setModelsLoading);
  const setServerInfo = useAppStore((s) => s.setServerInfo);

  const check = useCallback(async () => {
    try {
      const status = await getSessionStatus();
      setVia(status.via);
      setAuth(!status.auth_required || status.authenticated ? 'signed-in' : 'signed-out');
    } catch {
      // Server unreachable: open the app in its offline state rather than
      // demanding a passcode that cannot be checked.
      setAuth('signed-in');
    }
  }, []);

  useEffect(() => {
    void check();
    const onUnauthorized = () => setAuth('signed-out');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [check]);

  const onSignedIn = useCallback(async () => {
    // App-level loads ran before sign-in and were refused; redo them.
    setModelsLoading(true);
    fetchModels()
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
    fetchServerInfo().then(setServerInfo).catch(() => {});
    await check();
  }, [check, setModels, setModelsLoading, setServerInfo]);

  const signOut = useCallback(async () => {
    try {
      await endSession();
    } finally {
      setVia(null);
      setAuth('signed-out');
    }
  }, []);

  if (auth === 'checking') {
    return (
      <div className="jm" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <HellOrb state="thinking" size={140} showCaption={false} label="Connecting" />
      </div>
    );
  }
  if (auth === 'signed-out') return <MobileSignIn onSignedIn={onSignedIn} />;
  return <MobileApp authVia={via} signOut={signOut} />;
}

function MobileApp({ authVia, signOut }: { authVia: 'cookie' | 'bearer' | null; signOut: () => Promise<void> }) {
  const navigate = useNavigate();
  // The dashboard and the Hologram Builder are full-screen with their own controls.
  const onDashboard = /^\/m\/?$|^\/m\/hologram\/?$/.test(useLocation().pathname);
  const [online, setOnline] = useState<boolean | null>(null);
  const [serverLatencyMs, setLatency] = useState<number | null>(null);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const voiceOut = useAppStore((s) => s.settings.voiceOutputEnabled && s.settings.voiceAutoplay);
  const isStreaming = useAppStore((s) => s.streamState.isStreaming);
  const streamContent = useAppStore((s) => s.streamState.content);
  const ttsState = useTtsStore((s) => s.state);
  const { send } = useChatSender();
  const speech = useSpeech();

  // Replies are spoken from any tab, not just Chat.
  useAutoSpeakReplies();

  useEffect(() => {
    applyMobileDefaultsOnce(updateSettings);
  }, [updateSettings]);

  // Match the iOS status bar to the navy shell while it is mounted.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    meta?.setAttribute('content', '#050b1a');
    return () => {
      if (meta && previous) meta.setAttribute('content', previous);
    };
  }, []);

  useEffect(() => {
    const check = () => {
      const t0 = performance.now();
      checkHealth()
        .then((ok) => {
          setOnline(ok);
          setLatency(ok ? Math.round(performance.now() - t0) : null);
        })
        .catch(() => {
          setOnline(false);
          setLatency(null);
        });
    };
    check();
    const interval = setInterval(check, 20000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Short-lived orb states layered over the derived one.
  const [transient, setTransient] = useState<OrbState | null>(null);
  const transientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((s: OrbState, ms: number) => {
    if (transientTimer.current) clearTimeout(transientTimer.current);
    setTransient(s);
    transientTimer.current = setTimeout(() => setTransient(null), ms);
  }, []);
  useEffect(() => () => {
    if (transientTimer.current) clearTimeout(transientTimer.current);
  }, []);
  const activate = useCallback(() => flash('activating', 1100), [flash]);
  const flashError = useCallback(() => flash('error', 1600), [flash]);
  const [orbSettingsOpen, setOrbSettingsOpen] = useState(false);
  const openOrbSettings = useCallback(() => setOrbSettingsOpen(true), []);

  useEffect(() => {
    if (!speech.error) return;
    toast.error(speech.error);
    flashError();
  }, [speech.error, flashError]);

  const dictate = useCallback(async () => {
    try {
      const text = (await speech.stopRecording()).trim();
      return text || null;
    } catch {
      return null; // useSpeech already surfaced the error
    }
  }, [speech]);

  const listen = useCallback(async () => {
    if (speech.state !== 'idle') return;
    useTtsStore.getState().stop();
    await speech.startRecording();
  }, [speech]);

  const toggleTalk = useCallback(async () => {
    if (speech.state === 'transcribing') return;
    if (speech.state === 'recording') {
      const text = await dictate();
      if (!text) {
        toast("Didn't catch that — try again.");
        return;
      }
      navigate('/m/chat');
      await send(text);
      return;
    }
    // Interrupt HELL if it is mid-sentence, like a real conversation.
    useTtsStore.getState().stop();
    await speech.startRecording();
  }, [speech, dictate, navigate, send]);

  const derived = deriveOrbState({
    online,
    speech: speech.state,
    isStreaming,
    streamContent,
    tts: ttsState,
  });
  // Listening always shows, so the user knows the mic is live.
  const orbState: OrbState = transient && derived !== 'listening' ? transient : derived;

  const value = useMemo<MobileContextValue>(
    () => ({
      online,
      serverLatencyMs,
      orbState,
      speechState: speech.state,
      speechAvailable: speech.available,
      toggleTalk,
      listen,
      dictate,
      activate,
      flashError,
      openOrbSettings,
      authVia,
      signOut,
    }),
    [online, serverLatencyMs, orbState, speech.state, speech.available, toggleTalk, listen, dictate, activate, flashError, openOrbSettings, authVia, signOut],
  );

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    updateSettings({ voiceOutputEnabled: next, voiceAutoplay: next });
    if (!next) useTtsStore.getState().stop();
  };

  return (
    <MobileContext.Provider value={value}>
      <div className="jm" data-dashboard={onDashboard || undefined}>
        {!onDashboard && (
        <header className="jm-header">
          <span
            className="jm-status-dot"
            data-state={online === null ? 'pending' : online ? 'online' : 'offline'}
            role="status"
            aria-label={online === null ? 'Connecting' : online ? 'Online' : 'Offline'}
          />
          <HellWordmark />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="jm-icon-btn"
            onClick={toggleVoiceOut}
            aria-pressed={voiceOut}
            aria-label={voiceOut ? 'Spoken replies on' : 'Spoken replies off'}
            title={voiceOut ? 'Spoken replies on' : 'Spoken replies off'}
          >
            {voiceOut ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </header>
        )}

        <main className="jm-main">
          <Outlet />
        </main>

        {!onDashboard && (
        <nav className="jm-tabbar" aria-label="Main">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="jm-tab">
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        )}
        {orbSettingsOpen && <OrbCustomizer onClose={() => setOrbSettingsOpen(false)} />}
      </div>
    </MobileContext.Provider>
  );
}

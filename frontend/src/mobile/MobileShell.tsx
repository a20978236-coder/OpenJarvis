import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
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
import { JarvisOrb, type OrbState } from './JarvisOrb';
import { MobileSignIn } from './MobileSignIn';
import './mobile.css';
import { HellWordmark } from './HellWordmark';

/**
 * One voice pipeline for the whole mobile app: the orb on Home and the mic in
 * Chat drive the same recorder, so "listening" never shows in one place while
 * another is recording.
 */
interface MobileContextValue {
  online: boolean | null;
  orbState: OrbState;
  speechState: SpeechState;
  speechAvailable: boolean;
  /** Tap-to-talk: start recording, or stop and send what was heard. */
  toggleTalk: () => Promise<void>;
  /** Start recording for dictation into a field (see `dictate`). */
  listen: () => Promise<void>;
  /** Stop a recording and return the transcript without sending it. */
  dictate: () => Promise<string | null>;
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
  { to: '/m', label: 'Home', icon: Home, end: true },
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
        <JarvisOrb state="thinking" size={140} showCaption={false} label="Connecting" />
      </div>
    );
  }
  if (auth === 'signed-out') return <MobileSignIn onSignedIn={onSignedIn} />;
  return <MobileApp authVia={via} signOut={signOut} />;
}

function MobileApp({ authVia, signOut }: { authVia: 'cookie' | 'bearer' | null; signOut: () => Promise<void> }) {
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean | null>(null);
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
    const check = () => checkHealth().then(setOnline).catch(() => setOnline(false));
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

  useEffect(() => {
    if (speech.error) toast.error(speech.error);
  }, [speech.error]);

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
    // Interrupt Jarvis if it is mid-sentence, like a real conversation.
    useTtsStore.getState().stop();
    await speech.startRecording();
  }, [speech, dictate, navigate, send]);

  const orbState = deriveOrbState({
    online,
    speech: speech.state,
    isStreaming,
    streamContent,
    tts: ttsState,
  });

  const value = useMemo<MobileContextValue>(
    () => ({
      online,
      orbState,
      speechState: speech.state,
      speechAvailable: speech.available,
      toggleTalk,
      listen,
      dictate,
      authVia,
      signOut,
    }),
    [online, orbState, speech.state, speech.available, toggleTalk, listen, dictate, authVia, signOut],
  );

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    updateSettings({ voiceOutputEnabled: next, voiceAutoplay: next });
    if (!next) useTtsStore.getState().stop();
  };

  return (
    <MobileContext.Provider value={value}>
      <div className="jm">
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

        <main className="jm-main">
          <Outlet />
        </main>

        <nav className="jm-tabbar" aria-label="Main">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="jm-tab">
              <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </MobileContext.Provider>
  );
}

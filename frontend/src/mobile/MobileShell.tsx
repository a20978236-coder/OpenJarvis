import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Brain, CheckSquare, Home, MessageCircle, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../lib/store';
import { checkHealth, fetchModels, fetchServerInfo } from '../lib/api';
import { getSessionStatus, signOut as endSession, UNAUTHORIZED_EVENT } from '../lib/session-api';
import { useTtsStore } from '../lib/tts';
import type { SpeechState } from '../hooks/useSpeech';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { stopChatStream } from '../hooks/useChatSender';
import { getSpeechLevel } from '../lib/tts';
import { createVad } from '../lib/vad';
import { startWakeListener } from '../lib/device-speech';
import { useVoicePrefs } from '../lib/voice-prefs';
import { installErrorLog } from '../lib/error-log';
import { useUiPrefs } from '../lib/ui-prefs';
import { matchShortcutCommand, runShortcut, useShortcuts } from './apps/shortcuts';
import { useChatSender } from '../hooks/useChatSender';
import { useAutoSpeakReplies } from '../hooks/useAutoSpeakReplies';
import { deriveOrbState } from './orb-state';
import type { OrbState } from './orb-types';
import { MobileSignIn } from './MobileSignIn';
import './mobile.css';
import { HellWordmark } from './HellWordmark';
import { OrbCustomizer } from './OrbCustomizer';
import { isBuilderCommand } from './hologram/holo-commands';
import { useCamera } from './vision/camera';
import { HellOrb } from './HellOrb';
import { useHolo } from './hologram/holo-store';
import type { GestureName } from './gestures/gesture-recognizer';
import { ACTION_LABELS, effectiveAction, GESTURE_LABELS, stepCarousel, useGestures } from './gestures/gesture-settings';
import { useTouchGestures, type GestureContext } from './gestures/useTouchGestures';

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
  /** Stop a recording and discard it (nothing is sent). */
  cancelListening: () => void;
  /** Live 0..1 voice level for the orb (HELL speaking, or you), else null. */
  getVoiceLevel: () => number | null;
  /** Words heard so far (device recognition only). */
  interim: string;
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
  const location = useLocation();
  const onDashboard = /^\/m\/?$|^\/m\/(hologram|vision)\/?$/.test(location.pathname);
  const [online, setOnline] = useState<boolean | null>(null);
  const [serverLatencyMs, setLatency] = useState<number | null>(null);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const voiceOut = useAppStore((s) => s.settings.voiceOutputEnabled && s.settings.voiceAutoplay);
  const isStreaming = useAppStore((s) => s.streamState.isStreaming);
  const streamContent = useAppStore((s) => s.streamState.content);
  const ttsState = useTtsStore((s) => s.state);
  const { send } = useChatSender();
  const speech = useVoiceInput();
  // Long-lived listeners (wake phrase, timers) must use the current engine.
  const speechRef = useRef(speech);
  speechRef.current = speech;

  // Replies are spoken from any tab, not just Chat.
  useAutoSpeakReplies();

  useEffect(() => {
    applyMobileDefaultsOnce(updateSettings);
  }, [updateSettings]);
  useEffect(() => installErrorLog(), []);
  // Load (and apply) interface brightness / glow / animation on start.
  useUiPrefs((s) => s.animation);

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

  /**
   * A spoken turn is in progress or HELL is answering one: after the answer
   * (spoken, or finished streaming when voice output is off) HELL listens
   * again for a follow-up, when "Continue conversation" is on.
   */
  const voiceTurn = useRef<'idle' | 'answering'>('idle');
  /** The current listening session is a follow-up (silence ends it quietly). */
  const followUp = useRef(false);

  const interrupt = useCallback(() => {
    // Talking over HELL stops it, like a real conversation.
    useTtsStore.getState().stop();
    if (useAppStore.getState().streamState.isStreaming) stopChatStream();
  }, []);

  const listen = useCallback(async () => {
    if (speech.state !== 'idle') return;
    useTtsStore.getState().stop();
    followUp.current = false;
    await speech.startRecording();
  }, [speech]);

  /** Send what was heard: builder commands go to the builder, the rest to chat. */
  const deliver = useCallback(
    async (text: string) => {
      // "Run shortcut Lights off": only shortcuts you added in Apps.
      const sc = matchShortcutCommand(text, useShortcuts.getState().buttons);
      if (sc) {
        voiceTurn.current = 'idle';
        toast(`Running shortcut “${sc.label}”`);
        runShortcut(sc);
        return;
      }
      if (isBuilderCommand(text)) {
        voiceTurn.current = 'idle';
        navigate('/m/hologram', { state: { command: text } });
        return;
      }
      voiceTurn.current = 'answering';
      navigate('/m/chat');
      await send(text);
    },
    [navigate, send],
  );

  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  const toggleTalk = useCallback(async () => {
    if (speech.state === 'transcribing') return;
    if (speech.state === 'recording') {
      const text = await dictate();
      if (!text) {
        voiceTurn.current = 'idle';
        if (!followUp.current) toast("Didn't catch that — try again.");
        return;
      }
      await deliver(text);
      return;
    }
    interrupt();
    followUp.current = false;
    await speech.startRecording();
  }, [speech, dictate, deliver, interrupt]);

  // Device recogniser: it stops by itself when you pause; send that text.
  useEffect(() => {
    if (speech.engine !== 'device' || speech.state !== 'recording') return;
    const pending = speech.pendingResult();
    if (!pending) return;
    let live = true;
    pending
      .then((text) => {
        if (!live || !text.trim()) {
          if (live && !followUp.current) toast("Didn't catch that — try again.");
          if (live) voiceTurn.current = 'idle';
          return;
        }
        void deliverRef.current(text.trim());
      })
      .catch(() => {
        voiceTurn.current = 'idle';
      });
    return () => {
      live = false;
    };
  }, [speech.engine, speech.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server recorder: stop by itself when you pause (silence detection).
  const autoStop = useVoicePrefs((s) => s.autoStop);
  const toggleRef = useRef(toggleTalk);
  toggleRef.current = toggleTalk;
  useEffect(() => {
    if (speech.engine !== 'server' || speech.state !== 'recording' || !autoStop) return;
    const vad = createVad();
    const started = performance.now();
    const id = setInterval(() => {
      const level = speech.getLevel();
      if (level === null) {
        // Mic can't be measured (audio not unlocked yet): a tap ends a normal
        // turn; an unprompted follow-up must not keep the mic open.
        if (followUp.current && performance.now() - started > 8000) {
          clearInterval(id);
          speech.cancelRecording();
          voiceTurn.current = 'idle';
        }
        return;
      }
      const st = vad.feed(level, performance.now());
      if (st === 'done' || st === 'max') {
        clearInterval(id);
        void toggleRef.current();
      } else if (st === 'no-speech') {
        clearInterval(id);
        speech.cancelRecording();
        voiceTurn.current = 'idle';
        if (!followUp.current) toast("Didn't hear anything.");
      }
    }, 60);
    return () => clearInterval(id);
  }, [speech.engine, speech.state, autoStop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Continue the conversation: listen again once HELL has finished answering.
  const continueConversation = useVoicePrefs((s) => s.continueConversation);
  const ttsEngineBusy = ttsState !== 'idle';
  const wasBusy = useRef(false);
  useEffect(() => {
    const busy = isStreaming || ttsEngineBusy;
    const finished = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!finished || voiceTurn.current !== 'answering') return;
    // Voice output on: wait for the spoken answer (it starts right after the
    // stream ends), so only act once speech has ended too.
    const t = setTimeout(() => {
      const tts = useTtsStore.getState();
      const still = useAppStore.getState().streamState.isStreaming || tts.state !== 'idle';
      if (still) return;
      voiceTurn.current = 'idle';
      const sp = speechRef.current;
      if (!continueConversation || document.hidden || sp.state !== 'idle' || !sp.available) return;
      followUp.current = true;
      void sp.startRecording();
    }, voiceOut ? 900 : 300);
    return () => clearTimeout(t);
  }, [isStreaming, ttsEngineBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Hey HELL" while the app is open (iOS allows no background listening).
  const wakeOn = useVoicePrefs((s) => s.wakePhrase && s.allowDeviceRecognition);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const wakePaused = speech.state !== 'idle' || ttsEngineBusy || isStreaming || hidden;
  const activateRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!wakeOn || wakePaused) return;
    return startWakeListener(
      (remainder) => {
        activateRef.current();
        if (remainder.split(/\s+/).filter(Boolean).length >= 2) void deliverRef.current(remainder);
        else {
          followUp.current = false;
          void speechRef.current.startRecording();
        }
      },
      (msg) => {
        toast.error(msg);
        useVoicePrefs.getState().update({ wakePhrase: false });
      },
    );
  }, [wakeOn, wakePaused]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Live level for the orb: HELL's voice while speaking, yours while listening. */
  const getVoiceLevel = useCallback((): number | null => {
    if (useTtsStore.getState().state === 'speaking') return getSpeechLevel();
    if (speech.state === 'recording') return speech.getLevel();
    return null;
  }, [speech]);

  const derived = deriveOrbState({
    online,
    speech: speech.state,
    isStreaming,
    streamContent,
    tts: ttsState,
  });
  // Listening always shows, so the user knows the mic is live; a camera
  // frame being analysed shows the vision scan.
  const visionBusy = useCamera((s) => s.analyzing);
  const base: OrbState = visionBusy && derived !== 'listening' ? 'vision' : derived;
  const orbState: OrbState = transient && base !== 'listening' ? transient : base;

  // ---- Touchscreen gestures (Stage E) -----------------------------------
  const shellRef = useRef<HTMLDivElement>(null);
  const holoMode = useHolo((s) => s.mode);
  const path = location.pathname.replace(/\/+$/, '') || '/m';
  const gestureCtx: GestureContext = orbSettingsOpen
    ? 'off'
    : path === '/m'
      ? 'dashboard'
      : path === '/m/hologram'
        ? holoMode === 'fullscreen'
          ? 'fullscreen'
          : 'page' // the 3D canvas itself is excluded (it owns drag/pinch)
        : 'page';
  const [hud, setHud] = useState<{ text: string; key: number } | null>(null);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (hudTimer.current) clearTimeout(hudTimer.current);
  }, []);
  const showHud = useCallback((text: string) => {
    if (hudTimer.current) clearTimeout(hudTimer.current);
    setHud({ text, key: Date.now() });
    hudTimer.current = setTimeout(() => setHud(null), 1400);
  }, []);

  /** Run what `g` is assigned to here; returns a label, or null if it doesn't apply. */
  const runGesture = (g: GestureName): string | null => {
    const gs = useGestures.getState();
    const action = effectiveAction(gs, g);
    const dash = gestureCtx === 'dashboard';
    switch (action) {
      case 'open-hell':
        if (!dash) return null;
        if (gs.dashView === 'minimized') {
          gs.setDashView('full');
          return 'HELL restored';
        }
        navigate('/m/chat');
        return ACTION_LABELS[action];
      case 'minimize':
        if (!dash || gs.dashView === 'minimized') return null;
        gs.setDashView('minimized');
        return 'Minimized';
      case 'prev-module':
      case 'next-module': {
        if (!dash && gestureCtx !== 'page') return null;
        const to = stepCarousel(location.pathname, location.search, action === 'next-module' ? 1 : -1);
        if (!to) return null;
        navigate(to.route);
        return to.label;
      }
      case 'listen':
        if (!dash) return null;
        if (!speech.available || online === false) {
          flashError();
          return 'Voice is unavailable';
        }
        void toggleTalk();
        return speech.state === 'recording' ? 'Sending' : 'Listening';
      case 'open-settings':
        if (!dash) return null;
        navigate('/m/settings');
        return ACTION_LABELS[action];
      case 'expand-holo':
        if (!dash) return null;
        navigate('/m/hologram', { state: { present: true } });
        return ACTION_LABELS[action];
      case 'collapse-holo':
        if (gestureCtx === 'fullscreen') {
          useHolo.getState().setMode('edit');
          if ((location.state as { present?: boolean } | null)?.present) navigate('/m');
          return ACTION_LABELS[action];
        }
        if (dash && gs.dashView === 'full') {
          gs.setDashView('minimized');
          return 'Minimized';
        }
        return null;
      default:
        return null;
    }
  };
  useTouchGestures(shellRef, gestureCtx, (g) => {
    const label = runGesture(g);
    if (label && useGestures.getState().feedback) showHud(`${GESTURE_LABELS[g]} · ${label}`);
    return label !== null;
  });

  activateRef.current = activate;

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
      cancelListening: speech.cancelRecording,
      getVoiceLevel,
      interim: speech.interim,
      activate,
      flashError,
      openOrbSettings,
      authVia,
      signOut,
    }),
    [online, serverLatencyMs, orbState, speech.state, speech.available, toggleTalk, listen, dictate, speech.cancelRecording, getVoiceLevel, speech.interim, activate, flashError, openOrbSettings, authVia, signOut],
  );

  const toggleVoiceOut = () => {
    const next = !voiceOut;
    updateSettings({ voiceOutputEnabled: next, voiceAutoplay: next });
    if (!next) useTtsStore.getState().stop();
  };

  return (
    <MobileContext.Provider value={value}>
      <div className="jm" ref={shellRef} data-dashboard={onDashboard || undefined} data-gestures={gestureCtx}>
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
        <div className="jm-dimmer" aria-hidden="true" />
        <div className="jm-gesture-hud" role="status" aria-live="polite">
          {hud && <span key={hud.key}>{hud.text}</span>}
        </div>
      </div>
    </MobileContext.Provider>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { signIn, SignInError } from '../lib/session-api';
import { JarvisOrb } from './JarvisOrb';
import './mobile.css';

/**
 * Passcode screen. A correct passcode gets an HttpOnly session cookie from
 * the server; the passcode itself is never stored by the app.
 */
export function MobileSignIn({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Count down a rate-limit lockout.
  useEffect(() => {
    if (!waitUntil) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= waitUntil) setWaitUntil(null);
    }, 1000);
    return () => clearInterval(t);
  }, [waitUntil]);

  const locked = waitUntil !== null && now < waitUntil;
  const secondsLeft = locked ? Math.ceil((waitUntil! - now) / 1000) : 0;

  const submit = async () => {
    if (!passcode || busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(passcode);
      setPasscode('');
      await onSignedIn();
    } catch (e) {
      setPasscode('');
      if (e instanceof SignInError && e.retryAfterSeconds) {
        setWaitUntil(Date.now() + e.retryAfterSeconds * 1000);
        setNow(Date.now());
      }
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="jm">
      <header className="jm-header">
        <span className="jm-wordmark">J.A.R.V.I.S.</span>
      </header>
      <main className="jm-main" style={{ justifyContent: 'center', padding: '0 24px 48px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <JarvisOrb state={busy ? 'thinking' : 'idle'} size={170} showCaption={false} label="Jarvis" />
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 24, fontWeight: 600 }}>Welcome back</h1>
            <p style={{ fontSize: 15, color: 'var(--jm-text-2)', marginTop: 4 }}>Enter your passcode to unlock Jarvis.</p>
          </div>
          <form
            style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="sr-only" htmlFor="jm-passcode">Passcode</label>
            {/* A username field lets iOS Keychain save and fill the passcode. */}
            <input type="text" name="username" value="jarvis" autoComplete="username" readOnly hidden />
            <input
              id="jm-passcode"
              ref={inputRef}
              className="jm-field"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Passcode"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={locked}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'jm-signin-error' : undefined}
              enterKeyHint="go"
            />
            <button type="submit" className="jm-primary-btn" disabled={!passcode || busy || locked}>
              <Lock size={17} aria-hidden="true" /> {busy ? 'Checking…' : locked ? `Wait ${secondsLeft}s` : 'Unlock'}
            </button>
            <p id="jm-signin-error" role="alert" style={{ minHeight: 20, textAlign: 'center', fontSize: 14, color: 'var(--jm-danger)' }}>
              {error ?? ''}
            </p>
          </form>
          <p style={{ fontSize: 12, color: 'var(--jm-text-3)', textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
            The passcode is <code>OPENJARVIS_PASSCODE</code> on your server, or its API key if no passcode is set.
          </p>
        </div>
      </main>
    </div>
  );
}

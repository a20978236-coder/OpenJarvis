/**
 * Passcode sign-in for the browser (server: /v1/auth/session).
 *
 * The server answers a correct passcode with an HttpOnly cookie, which the
 * browser then sends automatically on same-origin requests. Nothing secret is
 * ever stored where page scripts can read it.
 */
import { apiFetch } from './api';

export interface SessionStatus {
  /** False when the server has no API key, so no sign-in is needed. */
  auth_required: boolean;
  authenticated: boolean;
  via: 'cookie' | 'bearer' | null;
}

/** Fired on any 401 from apiFetch, so the UI can ask the user to sign in. */
export const UNAUTHORIZED_EVENT = 'openjarvis:unauthorized';

export async function getSessionStatus(): Promise<SessionStatus> {
  const res = await apiFetch('/v1/auth/session', { cache: 'no-store' });
  // Servers from before passcode sign-in: no endpoint (404) means no cookie
  // support; a 401 there means a key is required and none was sent.
  if (res.status === 404) return { auth_required: false, authenticated: true, via: null };
  if (res.status === 401) return { auth_required: true, authenticated: false, via: null };
  if (!res.ok) throw new Error(`Could not check sign-in (HTTP ${res.status})`);
  return res.json();
}

export class SignInError extends Error {
  constructor(message: string, readonly retryAfterSeconds?: number) {
    super(message);
  }
}

export async function signIn(passcode: string): Promise<void> {
  const res = await apiFetch('/v1/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  if (res.ok) return;
  let detail = '';
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') detail = body.detail;
  } catch {
    // Non-JSON error body.
  }
  const retry = Number(res.headers.get('Retry-After')) || undefined;
  if (res.status === 401) throw new SignInError(detail || 'Wrong passcode');
  if (res.status === 429) throw new SignInError(detail || 'Too many attempts — try again later', retry);
  throw new SignInError(detail || `Sign-in failed (HTTP ${res.status})`);
}

export async function signOut(): Promise<void> {
  await apiFetch('/v1/auth/session', { method: 'DELETE' });
}

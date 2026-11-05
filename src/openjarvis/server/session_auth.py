"""Browser sessions for the Jarvis web/mobile app.

A phone should not have to store ``OPENJARVIS_API_KEY`` in page-readable
storage. Instead the user enters a passcode once; the server answers with an
``HttpOnly``, ``SameSite=Strict`` cookie holding a signed, expiring session
token. ``AuthMiddleware`` then accepts either that cookie or the existing
``Authorization: Bearer`` key, so programmatic clients are unaffected.

Token format: ``v1.<expiry>.<nonce>.<hmac>``, signed with a key derived from
the API key. The cookie never contains the API key, and rotating the API key
invalidates every session ("sign out everywhere").

The passcode is ``OPENJARVIS_PASSCODE`` when set (minimum 8 characters), so it
can be shorter than the API key to type on a phone; otherwise the API key
itself is the passcode.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from collections import deque
from typing import Deque, Dict, Optional
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

COOKIE_NAME = "oj_session"
SESSION_TTL_SECONDS = 30 * 24 * 3600
MIN_PASSCODE_LENGTH = 8
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_TOKEN_VERSION = "v1"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _secrets_equal(a: str, b: str) -> bool:
    try:
        return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
    except UnicodeEncodeError:
        return False


class LoginRateLimiter:
    """Sliding-window limit on failed passcode attempts.

    Per client and globally, so neither a single device nor many addresses
    together can brute-force the passcode quickly.
    """

    def __init__(
        self,
        *,
        per_client: int = 5,
        global_limit: int = 30,
        window_seconds: float = 600.0,
        clock=time.monotonic,  # noqa: ANN001 - injectable for tests
    ) -> None:
        self._per_client = per_client
        self._global = global_limit
        self._window = window_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._by_client: Dict[str, Deque[float]] = {}
        self._all: Deque[float] = deque()

    def _prune(self, q: Deque[float], now: float) -> None:
        while q and now - q[0] >= self._window:
            q.popleft()

    def retry_after(self, client: str) -> int:
        """Seconds until *client* may try again, or 0 if allowed now."""
        now = self._clock()
        with self._lock:
            self._prune(self._all, now)
            q = self._by_client.get(client)
            if q is not None:
                self._prune(q, now)
                if not q:
                    del self._by_client[client]
            waits = []
            if q and len(q) >= self._per_client:
                waits.append(self._window - (now - q[0]))
            if len(self._all) >= self._global:
                waits.append(self._window - (now - self._all[0]))
            return max(1, int(max(waits)) + 1) if waits else 0

    def record_failure(self, client: str) -> None:
        now = self._clock()
        with self._lock:
            self._by_client.setdefault(client, deque()).append(now)
            self._all.append(now)

    def reset(self, client: str) -> None:
        with self._lock:
            self._by_client.pop(client, None)


class SessionAuth:
    """Issues and verifies session tokens and checks login passcodes."""

    def __init__(
        self,
        api_key: str,
        *,
        passcode: Optional[str] = None,
        ttl_seconds: int = SESSION_TTL_SECONDS,
        clock=time.time,  # noqa: ANN001 - injectable for tests
    ) -> None:
        if not api_key:
            raise ValueError("SessionAuth requires an API key")
        self._key = hmac.new(
            api_key.encode("utf-8"), b"openjarvis-session-v1", hashlib.sha256
        ).digest()
        if passcode is None:
            passcode = os.environ.get("OPENJARVIS_PASSCODE", "")
        passcode = passcode or ""
        if passcode and len(passcode) < MIN_PASSCODE_LENGTH:
            logger.warning(
                "OPENJARVIS_PASSCODE is shorter than %d characters and is ignored;"
                " sign in with the API key instead.",
                MIN_PASSCODE_LENGTH,
            )
            passcode = ""
        self._passcode = passcode or api_key
        self.uses_custom_passcode = bool(passcode)
        self.ttl_seconds = int(ttl_seconds)
        self._clock = clock
        self.limiter = LoginRateLimiter()

    # -- passcode ---------------------------------------------------------

    def check_passcode(self, presented: str) -> bool:
        return _secrets_equal(presented or "", self._passcode)

    # -- tokens -----------------------------------------------------------

    def _sign(self, payload: str) -> str:
        mac = hmac.new(self._key, payload.encode("ascii"), hashlib.sha256).digest()
        return _b64(mac)

    def issue(self) -> str:
        expiry = int(self._clock()) + self.ttl_seconds
        payload = f"{_TOKEN_VERSION}.{expiry}.{secrets.token_urlsafe(16)}"
        return f"{payload}.{self._sign(payload)}"

    def verify(self, token: Optional[str]) -> bool:
        if not token or len(token) > 512:
            return False
        parts = token.split(".")
        if len(parts) != 4 or parts[0] != _TOKEN_VERSION:
            return False
        payload = ".".join(parts[:3])
        try:
            expected = self._sign(payload)
        except UnicodeEncodeError:
            return False
        if not _secrets_equal(parts[3], expected):
            return False
        try:
            expiry = int(parts[1])
        except ValueError:
            return False
        return self._clock() < expiry


def request_is_https(request) -> bool:  # noqa: ANN001
    """True if the browser reached us over HTTPS, directly or via a proxy.

    Tailscale Serve, Cloudflare Tunnel and similar terminate TLS and forward
    plain HTTP with ``X-Forwarded-Proto: https``. A spoofed header can only
    make the cookie *more* restrictive (``Secure``), never less.
    """
    if request.url.scheme == "https":
        return True
    proto = request.headers.get("x-forwarded-proto", "")
    return proto.split(",")[0].strip().lower() == "https"


def same_origin_request(request) -> bool:  # noqa: ANN001
    """Defense in depth against cross-site requests riding the cookie.

    ``SameSite=Strict`` already stops browsers attaching the cookie to
    cross-site requests; this additionally rejects anything the browser labels
    cross-site, or whose ``Origin`` host differs from the ``Host`` it was sent
    to. Requests with neither header (non-browser clients) are allowed —
    they cannot hold the cookie without the passcode anyway.
    """
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        return False
    origin = request.headers.get("origin")
    if not origin:
        return True
    if origin == "null":
        return False
    origin_host = urlsplit(origin).netloc.lower()
    host = request.headers.get("host", "").lower()
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    return origin_host in {host, forwarded_host.lower()} - {""}


def client_key(request) -> str:  # noqa: ANN001
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"

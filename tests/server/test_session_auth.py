"""Tests for passcode sign-in with HttpOnly session cookies (session_auth)."""

from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI, WebSocket  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from openjarvis.server.api_routes import include_all_routes  # noqa: E402
from openjarvis.server.auth_middleware import (  # noqa: E402
    AuthMiddleware,
    authenticate_websocket,
)
from openjarvis.server.personal_store import PersonalStore  # noqa: E402
from openjarvis.server.session_auth import (  # noqa: E402
    COOKIE_NAME,
    LoginRateLimiter,
    SessionAuth,
)
from openjarvis.server.session_routes import session_router  # noqa: E402

KEY = "oj_sk_test_key_1234567890"
HOST = "jarvis.example.ts.net"


def _app(passcode: str | None = None, api_key: str = KEY):
    app = FastAPI()
    include_all_routes(app)
    app.include_router(session_router)
    app.state.api_key = api_key
    app.state.personal_store = PersonalStore(":memory:")
    if api_key:
        app.state.session_auth = SessionAuth(api_key, passcode=passcode)
        app.add_middleware(AuthMiddleware, api_key=api_key)
    else:
        app.state.session_auth = None

    @app.websocket("/v1/test-ws")
    async def ws(websocket: WebSocket):
        ok, proto = authenticate_websocket(websocket, api_key)
        if not ok:
            await websocket.close(code=4401)
            return
        await websocket.accept(subprotocol=proto)
        await websocket.send_text("hi")
        await websocket.close()

    return app


def _client(app, https=True):
    base = f"https://{HOST}" if https else f"http://{HOST}"
    return TestClient(app, base_url=base)


def _login(c, passcode=KEY, **headers):
    return c.post("/v1/auth/session", json={"passcode": passcode}, headers=headers)


# ----------------------------------------------------------------------
# Token mechanics
# ----------------------------------------------------------------------


class TestTokens:
    def test_round_trip(self):
        auth = SessionAuth(KEY, passcode="")
        assert auth.verify(auth.issue())

    def test_token_does_not_contain_the_key(self):
        token = SessionAuth(KEY, passcode="").issue()
        assert KEY not in token and "test_key" not in token

    def test_tampered_or_foreign_tokens_rejected(self):
        auth = SessionAuth(KEY, passcode="")
        token = auth.issue()
        v, exp, nonce, sig = token.split(".")
        forged_expiry = f"{v}.{int(exp) + 10**6}.{nonce}.{sig}"
        assert not auth.verify(forged_expiry)
        assert not auth.verify(token[:-2] + ("AA" if token[-2:] != "AA" else "BB"))
        assert not SessionAuth("another-key-entirely", passcode="").verify(token)
        for junk in ["", "v1", "v2.1.2.3", "v1.notint.x.y", "x" * 600, "v1.1.2.3.4"]:
            assert not auth.verify(junk)

    def test_expiry(self):
        now = [1_000_000.0]
        auth = SessionAuth(KEY, passcode="", ttl_seconds=60, clock=lambda: now[0])
        token = auth.issue()
        now[0] += 59
        assert auth.verify(token)
        now[0] += 2
        assert not auth.verify(token)

    def test_rotating_api_key_signs_everyone_out(self):
        token = SessionAuth(KEY, passcode="").issue()
        assert not SessionAuth(KEY + "-rotated", passcode="").verify(token)

    def test_short_passcode_is_ignored(self):
        auth = SessionAuth(KEY, passcode="1234")
        assert not auth.uses_custom_passcode
        assert not auth.check_passcode("1234")
        assert auth.check_passcode(KEY)

    def test_custom_passcode_replaces_key_for_sign_in(self):
        auth = SessionAuth(KEY, passcode="correct horse")
        assert auth.check_passcode("correct horse")
        assert not auth.check_passcode(KEY)

    def test_passcode_from_environment(self, monkeypatch):
        monkeypatch.setenv("OPENJARVIS_PASSCODE", "from-the-env")
        assert SessionAuth(KEY).check_passcode("from-the-env")


class TestRateLimiter:
    def test_per_client_and_window(self):
        now = [0.0]
        rl = LoginRateLimiter(
            per_client=3, global_limit=100, window_seconds=60, clock=lambda: now[0]
        )
        for _ in range(3):
            assert rl.retry_after("a") == 0
            rl.record_failure("a")
        assert rl.retry_after("a") > 0
        assert rl.retry_after("b") == 0  # other clients unaffected
        now[0] += 61
        assert rl.retry_after("a") == 0

    def test_global_cap(self):
        rl = LoginRateLimiter(
            per_client=100, global_limit=4, window_seconds=60, clock=lambda: 0.0
        )
        for i in range(4):
            rl.record_failure(f"client-{i}")
        assert rl.retry_after("fresh-client") > 0

    def test_success_resets_client(self):
        rl = LoginRateLimiter(
            per_client=2, global_limit=100, window_seconds=60, clock=lambda: 0.0
        )
        rl.record_failure("a")
        rl.record_failure("a")
        rl.reset("a")
        assert rl.retry_after("a") == 0


# ----------------------------------------------------------------------
# HTTP flow
# ----------------------------------------------------------------------


class TestSignInFlow:
    def test_status_signed_out(self):
        c = _client(_app())
        assert c.get("/v1/auth/session").json() == {
            "auth_required": True,
            "authenticated": False,
            "via": None,
        }
        assert c.get("/v1/personal/tasks").status_code == 401

    def test_login_sets_hardened_cookie_and_unlocks_api(self):
        c = _client(_app())
        r = _login(c)
        assert r.status_code == 200
        set_cookie = r.headers["set-cookie"]
        assert set_cookie.startswith(f"{COOKIE_NAME}=")
        lowered = set_cookie.lower()
        for attr in (
            "httponly",
            "secure",
            "samesite=strict",
            "path=/",
            "max-age=2592000",
        ):
            assert attr in lowered, attr
        assert KEY not in set_cookie

        assert c.get("/v1/auth/session").json()["via"] == "cookie"
        assert c.get("/v1/personal/tasks").status_code == 200
        created = c.post(
            "/v1/personal/tasks",
            json={"title": "via cookie"},
            headers={"Origin": f"https://{HOST}"},
        )
        assert created.status_code == 201

    def test_cookie_not_marked_secure_on_plain_http(self):
        r = _login(_client(_app(), https=False))
        assert "secure" not in r.headers["set-cookie"].lower()

    def test_cookie_marked_secure_behind_https_proxy(self):
        c = _client(_app(), https=False)
        r = _login(c, **{"X-Forwarded-Proto": "https"})
        assert "secure" in r.headers["set-cookie"].lower()

    def test_wrong_passcode(self):
        c = _client(_app())
        r = _login(c, passcode="nope")
        assert r.status_code == 401
        assert "set-cookie" not in r.headers
        assert c.get("/v1/personal/tasks").status_code == 401

    def test_custom_passcode(self):
        c = _client(_app(passcode="open sesame"))
        assert _login(c, passcode=KEY).status_code == 401
        assert _login(c, passcode="open sesame").status_code == 200

    def test_brute_force_is_throttled(self):
        c = _client(_app())
        for _ in range(5):
            assert _login(c, passcode="guess").status_code == 401
        r = _login(c, passcode=KEY)  # even the right passcode waits it out
        assert r.status_code == 429
        assert int(r.headers["retry-after"]) > 0

    def test_logout_clears_cookie(self):
        c = _client(_app())
        _login(c)
        r = c.delete("/v1/auth/session")
        assert r.status_code == 204
        assert (
            f'{COOKIE_NAME}=""' in r.headers["set-cookie"]
            or "max-age=0" in r.headers["set-cookie"].lower()
        )
        c.cookies.clear()
        assert c.get("/v1/personal/tasks").status_code == 401

    def test_forged_cookie_rejected(self):
        c = _client(_app())
        c.cookies.set(COOKIE_NAME, "v1.9999999999.nonce.forgedsignature")
        assert c.get("/v1/personal/tasks").status_code == 401

    def test_no_api_key_means_no_sign_in_needed(self):
        c = _client(_app(api_key=""))
        assert c.get("/v1/auth/session").json()["auth_required"] is False
        assert _login(c, passcode="anything").json() == {
            "auth_required": False,
            "authenticated": True,
        }


class TestCrossSite:
    def test_cross_site_write_with_cookie_is_refused(self):
        c = _client(_app())
        _login(c)
        r = c.post(
            "/v1/personal/tasks",
            json={"title": "csrf"},
            headers={"Origin": "https://evil.example"},
        )
        assert r.status_code == 403
        r = c.post(
            "/v1/personal/tasks",
            json={"title": "csrf"},
            headers={"Sec-Fetch-Site": "cross-site"},
        )
        assert r.status_code == 403
        assert c.get("/v1/personal/tasks").json()["tasks"] == []

    def test_cross_site_sign_in_refused(self):
        c = _client(_app())
        r = _login(c, Origin="https://evil.example")
        assert r.status_code == 403
        assert "set-cookie" not in r.headers

    def test_bearer_clients_unaffected_by_origin_rules(self):
        c = _client(_app())
        r = c.post(
            "/v1/personal/tasks",
            json={"title": "script"},
            headers={
                "Authorization": f"Bearer {KEY}",
                "Origin": "https://elsewhere.example",
            },
        )
        assert r.status_code == 201


class TestBearerUnchanged:
    def test_bearer_still_works_and_wrong_bearer_still_fails(self):
        c = _client(_app())
        assert (
            c.get(
                "/v1/personal/tasks", headers={"Authorization": f"Bearer {KEY}"}
            ).status_code
            == 200
        )
        r = c.get("/v1/personal/tasks", headers={"Authorization": "Bearer wrong"})
        assert r.status_code == 401
        assert r.json()["detail"] == "Invalid API key"

    def test_wrong_bearer_is_not_rescued_by_a_valid_cookie(self):
        c = _client(_app())
        _login(c)
        r = c.get("/v1/personal/tasks", headers={"Authorization": "Bearer wrong"})
        assert r.status_code == 401

    def test_status_reports_bearer(self):
        c = _client(_app())
        r = c.get("/v1/auth/session", headers={"Authorization": f"Bearer {KEY}"})
        assert r.json()["via"] == "bearer"


class TestWebSocketCookie:
    """Starlette's test client does not forward its cookie jar or base host on
    WebSocket handshakes, so these pass the headers a browser would send."""

    @staticmethod
    def _headers(c, origin):
        token = c.cookies.get(COOKIE_NAME)
        headers = {"Origin": origin, "Host": HOST}
        if token:
            headers["Cookie"] = f"{COOKIE_NAME}={token}"
        return headers

    def test_same_origin_cookie_opens_socket(self):
        c = _client(_app())
        _login(c)
        with c.websocket_connect(
            "/v1/test-ws", headers=self._headers(c, f"https://{HOST}")
        ) as ws:
            assert ws.receive_text() == "hi"

    def test_cross_origin_socket_refused_even_with_cookie(self):
        c = _client(_app())
        _login(c)
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(
                "/v1/test-ws", headers=self._headers(c, "https://evil.example")
            ) as ws:
                ws.receive_text()

    def test_signed_out_socket_refused(self):
        c = _client(_app())
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect(
                "/v1/test-ws", headers=self._headers(c, f"https://{HOST}")
            ) as ws:
                ws.receive_text()

    def test_forged_cookie_socket_refused(self):
        c = _client(_app())
        headers = {
            "Origin": f"https://{HOST}",
            "Host": HOST,
            "Cookie": f"{COOKIE_NAME}=v1.9999999999.x.forged",
        }
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect("/v1/test-ws", headers=headers) as ws:
                ws.receive_text()


def test_create_app_enables_sign_in_only_with_a_key():
    from openjarvis.server.app import create_app

    engine = type(
        "E",
        (),
        {
            "engine_id": "mock",
            "health": lambda self: True,
            "list_models": lambda self: [],
        },
    )()
    with_key = create_app(engine, "m", api_key=KEY)
    assert isinstance(with_key.state.session_auth, SessionAuth)
    without = create_app(engine, "m")
    assert without.state.session_auth is None

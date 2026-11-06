"""``/v1/auth/session`` — sign a browser in with a passcode (see session_auth).

These three routes are exempt from ``AuthMiddleware`` so a signed-out browser
can reach them; each one checks credentials itself.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from openjarvis.server.session_auth import (
    COOKIE_NAME,
    SessionAuth,
    client_key,
    request_is_https,
    same_origin_request,
)

logger = logging.getLogger(__name__)

SESSION_PATH = "/v1/auth/session"
session_router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    passcode: str = Field(..., min_length=1, max_length=1024)


def _session_auth(request: Request) -> Optional[SessionAuth]:
    return getattr(request.app.state, "session_auth", None)


def _bearer_valid(request: Request) -> bool:
    from openjarvis.server.auth_middleware import _api_keys_match

    expected = getattr(request.app.state, "api_key", "") or ""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return (
        bool(expected)
        and scheme.lower() == "bearer"
        and _api_keys_match(token, expected)
    )


@session_router.get(SESSION_PATH)
def session_status(request: Request):
    """Whether this browser needs to sign in, and how it is signed in."""
    auth = _session_auth(request)
    if auth is None:
        return {"auth_required": False, "authenticated": True, "via": None}
    if auth.verify(request.cookies.get(COOKIE_NAME)):
        return {"auth_required": True, "authenticated": True, "via": "cookie"}
    if _bearer_valid(request):
        return {"auth_required": True, "authenticated": True, "via": "bearer"}
    return {"auth_required": True, "authenticated": False, "via": None}


@session_router.post(SESSION_PATH)
def session_login(req: LoginRequest, request: Request):
    """Exchange the passcode for a session cookie."""
    auth = _session_auth(request)
    if auth is None:
        return {"auth_required": False, "authenticated": True}
    if not same_origin_request(request):
        return JSONResponse({"detail": "Cross-site sign-in refused"}, status_code=403)

    who = client_key(request)
    wait = auth.limiter.retry_after(who)
    if wait:
        return JSONResponse(
            {"detail": f"Too many attempts. Try again in {wait // 60 + 1} min."},
            status_code=429,
            headers={"Retry-After": str(wait)},
        )
    if not auth.check_passcode(req.passcode):
        auth.limiter.record_failure(who)
        logger.warning("Failed sign-in attempt from %s", who)
        return JSONResponse({"detail": "Wrong passcode"}, status_code=401)

    auth.limiter.reset(who)
    resp = JSONResponse({"auth_required": True, "authenticated": True})
    resp.set_cookie(
        COOKIE_NAME,
        auth.issue(),
        max_age=auth.ttl_seconds,
        path="/",
        httponly=True,
        secure=request_is_https(request),
        samesite="strict",
    )
    return resp


@session_router.delete(SESSION_PATH, status_code=204)
def session_logout(request: Request):
    """Sign this browser out."""
    resp = Response(status_code=204)
    resp.delete_cookie(
        COOKIE_NAME,
        path="/",
        httponly=True,
        secure=request_is_https(request),
        samesite="strict",
    )
    return resp

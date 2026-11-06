"""Serve the built app efficiently: pre-compressed files and long caching.

The build writes ``file.br`` / ``file.gz`` next to each compressible file
(see ``frontend/scripts/compress-assets.mjs``). When the browser accepts
them, the compressed copy is sent with ``Content-Encoding`` — no CPU spent
per request, and chat streaming is untouched (no compression middleware).

Fingerprinted files under ``/assets`` (their names change whenever their
content does) are cached for a year; everything else stays ``no-cache`` so
updates (index.html, the service worker) are picked up at once.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Dict, Mapping, Optional

from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}

_ENCODINGS = (("br", ".br"), ("gzip", ".gz"))


def _accepts(accept_encoding: str) -> set:
    """Encodings the client accepts (an explicit ``q=0`` means refused)."""
    out = set()
    for part in (accept_encoding or "").lower().split(","):
        token, _, params = part.strip().partition(";")
        q = params.replace(" ", "")
        if token and not (q.startswith("q=0") and q.strip("q=0.") == ""):
            out.add(token)
    return out


def compressed_file_response(
    path: Path, accept_encoding: str, headers: Optional[Mapping[str, str]] = None
) -> FileResponse:
    """FileResponse for *path*, or its pre-compressed copy when accepted."""
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    base: Dict[str, str] = {
        "Vary": "Accept-Encoding",
        **(dict(headers) if headers else {}),
    }
    ok = _accepts(accept_encoding)
    for enc, ext in _ENCODINGS:
        if enc in ok:
            candidate = path.with_name(path.name + ext)
            if candidate.is_file():
                return FileResponse(
                    candidate,
                    media_type=media_type,
                    headers={**base, "Content-Encoding": enc},
                )
    return FileResponse(path, media_type=media_type, headers=base)


class CompressedAssets(StaticFiles):
    """``/assets``: pre-compressed copies and year-long caching (hashed names)."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if response.status_code != 200 or not isinstance(response, FileResponse):
            return response
        accept = ""
        for k, v in scope.get("headers", []):
            if k == b"accept-encoding":
                accept = v.decode("latin-1")
                break
        return compressed_file_response(Path(response.path), accept, IMMUTABLE)

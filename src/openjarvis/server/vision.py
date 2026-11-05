"""Camera vision support for ``/v1/chat/completions``.

Clients send images the OpenAI way: a user message whose ``content`` is a
list of parts, e.g. ``{"type": "text", "text": "what is this?"}`` and
``{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}``.

Rules (enforced here so every client gets the same behaviour):

* Only inline ``data:`` images (JPEG, PNG, WebP) are accepted. Remote URLs
  are refused, so the server never fetches arbitrary addresses (SSRF).
* At most ``MAX_IMAGES`` per message and ``MAX_IMAGE_BYTES`` each.
* Images are forwarded only to engines that pass them to the model
  (Ollama). If the engine or the model cannot see images, the request is
  refused with an explanation instead of answering as if it had looked.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 4_500_000
_DATA_URL = re.compile(
    r"^data:(image/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$"
)
_MAGIC = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
}

VISION_MODEL_HINT = "ollama pull qwen2.5vl:7b"


def _check_image(b64: str) -> str:
    """Validate base64 image data; return it without whitespace."""
    data = re.sub(r"\s+", "", b64)
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image is not valid base64") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError(f"image is too large (max {MAX_IMAGE_BYTES // 1_000_000} MB)")
    is_webp = raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    if not is_webp and not any(raw.startswith(m) for m in _MAGIC):
        raise ValueError("only JPEG, PNG and WebP images are supported")
    return data


def split_content(content: Any) -> Tuple[str, List[str]]:
    """Turn OpenAI-style content (str or list of parts) into (text, images)."""
    if content is None:
        return "", []
    if isinstance(content, str):
        return content, []
    if not isinstance(content, list):
        raise ValueError("content must be a string or a list of parts")
    texts: List[str] = []
    images: List[str] = []
    for part in content:
        if not isinstance(part, dict):
            raise ValueError("each content part must be an object")
        kind = part.get("type")
        if kind == "text":
            texts.append(str(part.get("text", "")))
        elif kind == "image_url":
            url = part.get("image_url")
            url = url.get("url") if isinstance(url, dict) else url
            if not isinstance(url, str):
                raise ValueError("image_url.url must be a string")
            m = _DATA_URL.match(url.strip())
            if not m:
                raise ValueError(
                    "images must be inline data: URLs (JPEG, PNG or WebP);"
                    " remote image links are not fetched"
                )
            images.append(_check_image(m.group(2)))
        else:
            raise ValueError(f"unsupported content part type {kind!r}")
    if len(images) > MAX_IMAGES:
        raise ValueError(f"at most {MAX_IMAGES} images per message")
    return "\n".join(t for t in texts if t), images


def check_images(images: Optional[List[str]]) -> Optional[List[str]]:
    """Validate images supplied via the (internal) ``images`` field."""
    if not images:
        return None
    if len(images) > MAX_IMAGES:
        raise ValueError(f"at most {MAX_IMAGES} images per message")
    return [_check_image(i) for i in images]


# ---------------------------------------------------------------------------
# Engine / model capability
# ---------------------------------------------------------------------------


def resolve_engine(engine: Any, model: str, _depth: int = 0) -> Any:
    """Unwrap guardrail/multi-engine wrappers to the engine serving *model*."""
    if engine is None or _depth > 6:
        return engine
    # Look only at real attributes (class methods / instance fields), so mock
    # or proxy objects that answer every attribute lookup can't loop here.
    if callable(getattr(type(engine), "_engine_for", None)):
        try:
            return resolve_engine(engine._engine_for(model), model, _depth + 1)
        except Exception:
            return engine
    fields = getattr(engine, "__dict__", {})
    # GuardrailsEngine keeps ``_engine``; InstrumentedEngine keeps ``_inner``.
    for name in ("_engine", "_inner"):
        inner = fields.get(name)
        if inner is not None and inner is not engine:
            return resolve_engine(inner, model, _depth + 1)
    return engine


def engine_accepts_images(engine: Any, model: str) -> bool:
    """Only the Ollama adapter forwards ``Message.images`` to the model."""
    return getattr(resolve_engine(engine, model), "engine_id", "") == "ollama"


_cap_cache: Dict[Tuple[str, str], Tuple[float, Optional[bool]]] = {}
_CAP_TTL = 600.0


def model_sees_images(engine: Any, model: str) -> Optional[bool]:
    """True/False from Ollama's model capabilities; None if it can't be told."""
    real = resolve_engine(engine, model)
    if getattr(real, "engine_id", "") != "ollama":
        return False
    host = getattr(real, "_host", "")
    key = (host, model)
    hit = _cap_cache.get(key)
    if hit and time.monotonic() - hit[0] < _CAP_TTL:
        return hit[1]
    result: Optional[bool]
    try:
        client = getattr(real, "_client", None)
        if isinstance(client, httpx.Client):
            r = client.post("/api/show", json={"model": model}, timeout=5.0)
        else:
            r = httpx.post(f"{host}/api/show", json={"model": model}, timeout=5.0)
        r.raise_for_status()
        caps = (r.json() or {}).get("capabilities")
        result = "vision" in caps if isinstance(caps, list) else None
    except Exception as exc:  # Unknown is not "no": don't block on a flaky probe.
        logger.debug("Vision capability probe failed for %s: %s", model, exc)
        result = None
    _cap_cache[key] = (time.monotonic(), result)
    return result


def vision_refusal(engine: Any, model: str) -> Optional[str]:
    """A user-facing reason the request can't include images, or None."""
    if not engine_accepts_images(engine, model):
        return (
            f"The engine serving {model!r} can't receive images, so HELL can't"
            " look at the camera with it. Vision works with Ollama models,"
            f" e.g. `{VISION_MODEL_HINT}`."
        )
    if model_sees_images(engine, model) is False:
        return (
            f"The model {model!r} can't see images. Choose a vision model,"
            f" e.g. `{VISION_MODEL_HINT}`, and select it in HELL."
        )
    return None


__all__ = [
    "MAX_IMAGES",
    "MAX_IMAGE_BYTES",
    "check_images",
    "engine_accepts_images",
    "model_sees_images",
    "resolve_engine",
    "split_content",
    "vision_refusal",
]

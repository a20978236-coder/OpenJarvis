"""HELL memory controls: approval, remembering, clearing and switching off.

Settings live in ``<config dir>/memory_prefs.json``:

* ``learning`` — ``off`` (learn nothing), ``ask`` (learned facts wait for
  your approval before HELL may use them) or ``auto`` (clean facts are used
  at once; personal details still wait for approval). Secrets are never
  stored in any mode (see :mod:`openjarvis.memory.sensitive`).
* ``use_in_replies`` — whether memories are put into HELL's replies at all.

Turning both off is "memory disabled".
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

memory_controls_router = APIRouter(prefix="/v1/memory", tags=["memory"])

LEARNING_MODES = ("off", "ask", "auto")
SENSITIVE_POLICY = (
    "Passwords, API keys, card numbers and similar secrets are never stored. "
    "Personal details (health, contact details, address, finances) are kept "
    "only after you approve them."
)


def _prefs_path() -> Path:
    from openjarvis.core.config import get_config_dir

    return Path(get_config_dir()) / "memory_prefs.json"


def load_prefs(default_learning: str = "off") -> Dict[str, Any]:
    prefs: Dict[str, Any] = {"learning": default_learning, "use_in_replies": True}
    try:
        raw = json.loads(_prefs_path().read_text(encoding="utf-8"))
        if raw.get("learning") in LEARNING_MODES:
            prefs["learning"] = raw["learning"]
        if isinstance(raw.get("use_in_replies"), bool):
            prefs["use_in_replies"] = raw["use_in_replies"]
        prefs["saved"] = True
    except FileNotFoundError:
        prefs["saved"] = False
    except Exception:
        logger.warning("Ignoring unreadable memory preferences", exc_info=True)
        prefs["saved"] = False
    return prefs


def save_prefs(prefs: Dict[str, Any]) -> None:
    path = _prefs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"learning": prefs["learning"], "use_in_replies": prefs["use_in_replies"]}
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".memory_prefs.")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _facts_path(config: Any) -> Optional[str]:
    mem = getattr(config, "memory", None)
    return getattr(mem, "facts_path", None) if mem is not None else None


def _build_service(app: Any) -> Any:
    """A fact store + (if a model is available) the learner, not started."""
    from openjarvis.memory.extractor import FactExtractor
    from openjarvis.memory.service import MemoryService, _build_scanner
    from openjarvis.memory.store import create_fact_store

    config = getattr(app.state, "config", None)
    mem = getattr(config, "memory", None)
    store = create_fact_store(
        getattr(mem, "backend", "local") if mem is not None else "local",
        path=_facts_path(config),
        max_facts=getattr(mem, "max_facts", 1000) if mem is not None else 1000,
    )
    engine = getattr(app.state, "engine", None)
    model = (getattr(mem, "extraction_model", "") if mem is not None else "") or getattr(app.state, "model", "") or ""
    extractor = FactExtractor(engine, model) if engine is not None and model else None
    svc = MemoryService(store, extractor, event_bus=getattr(app.state, "bus", None), scanner=_build_scanner())
    svc._hell_can_learn = extractor is not None  # type: ignore[attr-defined]
    return svc


def _can_learn(svc: Any) -> bool:
    flag = getattr(svc, "_hell_can_learn", None)
    if flag is not None:
        return bool(flag)
    return getattr(svc, "_extractor", None) is not None


def _apply(app: Any, svc: Any, prefs: Dict[str, Any]) -> None:
    learning = prefs["learning"]
    if svc is not None:
        if learning in ("ask", "auto"):
            svc.set_approval(learning)
            svc.set_paused(False)
            if not svc.is_running and _can_learn(svc):
                svc.start()
                app.state._owns_memory_service = True
        else:
            svc.set_paused(True)
    app.state.memory_use_in_replies = bool(prefs["use_in_replies"])
    app.state.memory_prefs = prefs


def init_memory_controls(app: Any) -> None:
    """Apply saved memory settings at startup. Never raises."""
    try:
        svc = getattr(app.state, "memory_service", None)
        # Config-enabled learning keeps working, but HELL asks first.
        prefs = load_prefs(default_learning="ask" if svc is not None else "off")
        facts_file = _facts_path(getattr(app.state, "config", None))
        has_facts = bool(facts_file) and Path(facts_file).exists()
        if svc is None and (prefs["learning"] != "off" or has_facts):
            svc = _build_service(app)
            app.state.memory_service = svc
        _apply(app, svc, prefs)
    except Exception:
        logger.warning("Memory controls could not be initialised", exc_info=True)
        app.state.memory_use_in_replies = True


def shutdown_memory_controls(app: Any) -> None:
    if getattr(app.state, "_owns_memory_service", False):
        svc = getattr(app.state, "memory_service", None)
        try:
            if svc is not None:
                svc.stop()
        except Exception:
            pass


def _service(request: Request, create: bool = False) -> Any:
    app = request.app
    svc = getattr(app.state, "memory_service", None)
    if svc is None and create:
        try:
            svc = _build_service(app)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Memory store unavailable: {exc}") from exc
        app.state.memory_service = svc
        _apply(app, svc, _prefs(request))
    return svc


def _prefs(request: Request) -> Dict[str, Any]:
    prefs = getattr(request.app.state, "memory_prefs", None)
    if prefs is None:
        prefs = load_prefs()
        request.app.state.memory_prefs = prefs
    return prefs


def _counts(svc: Any) -> Dict[str, int]:
    if svc is None:
        return {"total": 0, "pending": 0, "quarantined": 0}
    facts = svc.list_facts()
    return {
        "total": len(facts),
        "pending": sum(1 for f in facts if (f.trust or "") == "pending"),
        "quarantined": sum(1 for f in facts if (f.trust or "") == "untrusted"),
    }


@memory_controls_router.get("/settings")
def get_memory_settings(request: Request):
    svc = _service(request)
    prefs = _prefs(request)
    try:
        backend = _documents_backend(request)
        documents = backend.count() if backend is not None else 0
    except Exception:
        documents = 0
    if svc is not None:
        can_learn = _can_learn(svc)
    else:
        can_learn = bool(getattr(request.app.state, "engine", None)) and bool(getattr(request.app.state, "model", ""))
    return {
        "learning": prefs["learning"],
        "use_in_replies": bool(prefs["use_in_replies"]),
        "learning_available": can_learn,
        "facts": _counts(svc),
        "documents": documents,
        "sensitive_policy": SENSITIVE_POLICY,
    }


class MemorySettingsUpdate(BaseModel):
    learning: Optional[str] = Field(default=None)
    use_in_replies: Optional[bool] = None


@memory_controls_router.put("/settings")
def put_memory_settings(body: MemorySettingsUpdate, request: Request):
    prefs = dict(_prefs(request))
    if body.learning is not None:
        if body.learning not in LEARNING_MODES:
            raise HTTPException(status_code=422, detail=f"learning must be one of {', '.join(LEARNING_MODES)}")
        prefs["learning"] = body.learning
    if body.use_in_replies is not None:
        prefs["use_in_replies"] = body.use_in_replies
    svc = _service(request, create=prefs["learning"] != "off")
    if prefs["learning"] != "off" and svc is not None and not _can_learn(svc):
        raise HTTPException(status_code=409, detail="No AI model is available to learn from conversations")
    try:
        save_prefs(prefs)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not save memory settings: {exc}") from exc
    prefs["saved"] = True
    _apply(request.app, svc, prefs)
    return get_memory_settings(request)


class FactRef(BaseModel):
    index: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=2000)


@memory_controls_router.post("/facts/approve")
def approve_fact(body: FactRef, request: Request):
    svc = _service(request)
    if svc is None:
        raise HTTPException(status_code=503, detail="Memory is off")
    if not svc.approve_fact(body.index, body.text):
        raise HTTPException(status_code=409, detail="That memory changed or is already approved — refresh and try again")
    return {"status": "approved"}


class RememberRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@memory_controls_router.post("/facts/remember")
def remember_fact(body: RememberRequest, request: Request):
    svc = _service(request, create=True)
    result = svc.remember(body.text)
    if result is None:
        raise HTTPException(status_code=422, detail="That looks like a password, key or card number. HELL never stores secrets.")
    return {"status": "stored" if result else "already_known"}


@memory_controls_router.post("/facts/clear")
def clear_facts(request: Request):
    svc = _service(request)
    if svc is None:
        return {"cleared": 0}
    return {"cleared": int(svc.clear_facts() or 0)}


def _documents_backend(request: Request) -> Any:
    from openjarvis.server.api_routes import _get_memory_backend

    return _get_memory_backend(request)


@memory_controls_router.post("/documents/clear")
def clear_documents(request: Request):
    backend = _documents_backend(request)
    if backend is None:
        return {"cleared": 0}
    try:
        n = backend.count()
        backend.clear()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"cleared": int(n)}

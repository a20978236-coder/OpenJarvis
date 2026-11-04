"""``/v1/personal`` — the user's notes and tasks for the Jarvis mobile app.

Lives under ``/v1`` so ``AuthMiddleware`` protects it like every other API
route when ``OPENJARVIS_API_KEY`` is set.
"""

from __future__ import annotations

import datetime as _dt
import threading
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator

from openjarvis.server.personal_store import PersonalStore

personal_router = APIRouter(prefix="/v1/personal", tags=["personal"])

_TITLE_MAX = 200
_BODY_MAX = 20_000

_init_lock = threading.Lock()


def _store(request: Request) -> PersonalStore:
    """App-scoped store, created on first use (tests may preset one)."""
    store = getattr(request.app.state, "personal_store", None)
    if store is None:
        with _init_lock:
            store = getattr(request.app.state, "personal_store", None)
            if store is None:
                store = PersonalStore()
                request.app.state.personal_store = store
    return store


def _clean_due(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        return _dt.date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError("due must be a date like 2026-11-05") from exc


# ----------------------------------------------------------------------
# Notes
# ----------------------------------------------------------------------


class NoteCreate(BaseModel):
    title: str = Field("", max_length=_TITLE_MAX)
    body: str = Field("", max_length=_BODY_MAX)
    pinned: bool = False

    @field_validator("title")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=_TITLE_MAX)
    body: Optional[str] = Field(None, max_length=_BODY_MAX)
    pinned: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v is not None else v


@personal_router.get("/notes")
def list_notes(request: Request, q: str = Query("", max_length=_TITLE_MAX)):
    return {"notes": _store(request).list_notes(q.strip())}


@personal_router.post("/notes", status_code=201)
def create_note(req: NoteCreate, request: Request):
    if not req.title and not req.body.strip():
        raise HTTPException(status_code=422, detail="A note needs a title or some text")
    return _store(request).create_note(req.title, req.body, req.pinned)


@personal_router.patch("/notes/{note_id}")
def update_note(note_id: str, req: NoteUpdate, request: Request):
    note = _store(request).update_note(note_id, req.model_dump(exclude_unset=True))
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@personal_router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: str, request: Request):
    if not _store(request).delete_note(note_id):
        raise HTTPException(status_code=404, detail="Note not found")
    return Response(status_code=204)


# ----------------------------------------------------------------------
# Tasks
# ----------------------------------------------------------------------


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=_TITLE_MAX)
    notes: str = Field("", max_length=_BODY_MAX)
    due: Optional[str] = None
    priority: int = Field(0, ge=0, le=2)

    @field_validator("title")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @field_validator("due")
    @classmethod
    def _due(cls, v: Optional[str]) -> Optional[str]:
        return _clean_due(v)


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=_TITLE_MAX)
    notes: Optional[str] = Field(None, max_length=_BODY_MAX)
    due: Optional[str] = None
    priority: Optional[int] = Field(None, ge=0, le=2)
    done: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @field_validator("due")
    @classmethod
    def _due(cls, v: Optional[str]) -> Optional[str]:
        return _clean_due(v)


@personal_router.get("/tasks")
def list_tasks(
    request: Request,
    status: Literal["open", "done", "all"] = "open",
):
    return {"tasks": _store(request).list_tasks(status)}


@personal_router.post("/tasks", status_code=201)
def create_task(req: TaskCreate, request: Request):
    return _store(request).create_task(req.title, req.notes, req.due, req.priority)


@personal_router.patch("/tasks/{task_id}")
def update_task(task_id: str, req: TaskUpdate, request: Request):
    task = _store(request).update_task(task_id, req.model_dump(exclude_unset=True))
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@personal_router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, request: Request):
    if not _store(request).delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return Response(status_code=204)


@personal_router.get("/summary")
def summary(request: Request):
    """Counts for the mobile home screen."""
    return _store(request).counts()

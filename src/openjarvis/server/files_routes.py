"""``/v1/hell/files`` — files kept on your HELL server, sent from the iPhone.

Files are stored under ``<config dir>/files/`` with random ids (never the
uploaded name, so paths can't be abused). Downloads are always served as
attachments except for plain images and PDFs, and with ``nosniff``, so an
uploaded HTML/SVG file can never run as a page on HELL's origin.

"Add to memory" extracts the text (txt, md, csv, json, pdf, docx), splits it
into chunks and stores them in HELL's memory so replies can draw on it.
Secrets in the text (passwords, keys, card numbers) are replaced with
"[secret removed]" before anything is stored.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

files_router = APIRouter(prefix="/v1/hell/files", tags=["hell"])

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES = 300
TEXT_TYPES = {".txt", ".md", ".csv", ".json", ".log"}
DOC_TYPES = {".pdf", ".docx"}
INLINE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"}
_ID = re.compile(r"^[0-9a-f]{32}$")
_lock = threading.Lock()


def _dir() -> Path:
    from openjarvis.core.config import get_config_dir

    d = Path(get_config_dir()) / "files"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _dir() / "index.json"


def _load() -> List[Dict[str, Any]]:
    try:
        data = json.loads(_index_path().read_text(encoding="utf-8"))
        return [
            f for f in data if isinstance(f, dict) and _ID.match(str(f.get("id", "")))
        ]
    except FileNotFoundError:
        return []
    except Exception:
        logger.warning("Unreadable files index; starting empty", exc_info=True)
        return []


def _save(items: List[Dict[str, Any]]) -> None:
    path = _index_path()
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".index.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(items, f)
    os.replace(tmp, path)


def _clean_name(name: str) -> str:
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)[:120]
    return base or "file"


def _public(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": item["id"],
        "name": item["name"],
        "size": item["size"],
        "type": item["type"],
        "created_at": item["created_at"],
        "in_memory": bool(item.get("memory_ids")),
        "memory_chunks": len(item.get("memory_ids") or []),
        "can_add_to_memory": Path(item["name"]).suffix.lower()
        in TEXT_TYPES | DOC_TYPES,
    }


def _find(file_id: str) -> Dict[str, Any]:
    if not _ID.match(file_id):
        raise HTTPException(status_code=404, detail="File not found")
    for item in _load():
        if item["id"] == file_id:
            return item
    raise HTTPException(status_code=404, detail="File not found")


@files_router.get("")
def list_files():
    items = sorted(_load(), key=lambda f: f.get("created_at", 0), reverse=True)
    total = sum(int(f.get("size", 0)) for f in items)
    return {
        "files": [_public(f) for f in items],
        "total_bytes": total,
        "max_file_bytes": MAX_FILE_BYTES,
    }


@files_router.post("", status_code=201)
async def upload_file(file: UploadFile = File(...)):
    name = _clean_name(file.filename or "")
    with _lock:
        if len(_load()) >= MAX_FILES:
            raise HTTPException(
                status_code=409,
                detail=f"HELL keeps at most {MAX_FILES} files — delete some first",
            )
    file_id = uuid.uuid4().hex
    dest = _dir() / file_id
    size = 0
    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Files can be up to {MAX_FILE_BYTES // (1024 * 1024)} MB"
                        ),
                    )
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="The file is empty")
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    item = {
        "id": file_id,
        "name": name,
        "size": size,
        "type": ctype,
        "created_at": time.time(),
        "memory_ids": [],
    }
    with _lock:
        items = _load()
        items.append(item)
        _save(items)
    return _public(item)


@files_router.get("/{file_id}")
def download_file(file_id: str):
    item = _find(file_id)
    path = _dir() / item["id"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File is missing on the server")
    ctype = item["type"] if item["type"] in INLINE_TYPES else "application/octet-stream"
    disposition = "inline" if item["type"] in INLINE_TYPES else "attachment"
    return FileResponse(
        path,
        media_type=ctype,
        filename=item["name"],
        content_disposition_type=disposition,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


def _memory_backend(request: Request) -> Any:
    from openjarvis.server.api_routes import _get_memory_backend

    return _get_memory_backend(request)


def _forget_in_memory(request: Request, item: Dict[str, Any]) -> None:
    ids = item.get("memory_ids") or []
    if not ids:
        return
    try:
        backend = _memory_backend(request)
    except HTTPException:
        backend = None
    if backend is None:
        return
    for doc_id in ids:
        try:
            backend.delete(doc_id)
        except Exception:
            logger.debug("Could not delete memory chunk %s", doc_id, exc_info=True)


@files_router.delete("/{file_id}", status_code=204)
def delete_file(file_id: str, request: Request):
    item = _find(file_id)
    _forget_in_memory(request, item)
    with _lock:
        items = [f for f in _load() if f["id"] != file_id]
        _save(items)
    (_dir() / file_id).unlink(missing_ok=True)


def _extract_text(name: str, data: bytes) -> str:
    ext = Path(name).suffix.lower()
    if ext in TEXT_TYPES:
        try:
            return data.decode("utf-8")
        except UnicodeDecodeError:
            return data.decode("latin-1")
    from openjarvis.server.upload_router import (
        _extract_text_from_docx,
        _extract_text_from_pdf,
    )

    if ext == ".pdf":
        return _extract_text_from_pdf(data)
    if ext == ".docx":
        return _extract_text_from_docx(data)
    raise HTTPException(
        status_code=415,
        detail="HELL can only read text, Markdown, CSV, JSON, PDF and Word files",
    )


@files_router.post("/{file_id}/memory")
def add_to_memory(file_id: str, request: Request):
    from openjarvis.memory.sensitive import redact
    from openjarvis.server.upload_router import _chunk_text

    item = _find(file_id)
    backend = _memory_backend(request)
    if backend is None:
        raise HTTPException(
            status_code=503, detail="Memory is not configured on this server"
        )
    data = (_dir() / item["id"]).read_bytes()
    text = _extract_text(item["name"], data).strip()
    if not text:
        raise HTTPException(status_code=422, detail="No text found in this file")
    _forget_in_memory(request, item)  # re-adding replaces the old chunks
    ids: List[str] = []
    redacted = 0
    for i, raw in enumerate(_chunk_text(text)):
        chunk, n = redact(raw)
        redacted += n
        ids.append(
            backend.store(
                chunk,
                source=f"file:{item['name']}",
                metadata={
                    "source": "hell-files",
                    "file_id": item["id"],
                    "title": item["name"],
                    "chunk": i,
                },
            )
        )
    with _lock:
        items = _load()
        for f in items:
            if f["id"] == file_id:
                f["memory_ids"] = ids
                item = f
        _save(items)
    return {**_public(item), "secrets_removed": redacted}


@files_router.delete("/{file_id}/memory")
def remove_from_memory(file_id: str, request: Request):
    item = _find(file_id)
    _forget_in_memory(request, item)
    with _lock:
        items = _load()
        for f in items:
            if f["id"] == file_id:
                f["memory_ids"] = []
                item = f
        _save(items)
    return _public(item)

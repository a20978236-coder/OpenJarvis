"""SQLite store for the user's personal notes and tasks.

Backs the ``/v1/personal`` API used by the Jarvis mobile app. Everything stays
on the user's own machine in ``<OPENJARVIS_HOME>/personal.db``.
"""

from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional

from openjarvis.core.paths import get_config_dir

# Fields a caller may change on each record. Anything else is ignored, so a
# client can never overwrite ids or timestamps.
NOTE_FIELDS = ("title", "body", "pinned")
TASK_FIELDS = ("title", "notes", "due", "priority", "done")


def _locked(func):
    @wraps(func)
    def wrapped(self, *args, **kwargs):
        with self._lock:
            return func(self, *args, **kwargs)

    return wrapped


def _note(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "body": row["body"],
        "pinned": bool(row["pinned"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _task(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"],
        "due": row["due"],
        "priority": row["priority"],
        "done": bool(row["done"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "completed_at": row["completed_at"],
    }


class PersonalStore:
    """Notes and tasks, safe to share across the server's worker threads."""

    def __init__(self, db_path: str = "") -> None:
        if not db_path:
            db_path = str(get_config_dir() / "personal.db")
        if db_path != ":memory:":
            from openjarvis.security.file_utils import secure_create

            # Owner-only permissions: notes are personal data.
            secure_create(Path(db_path))
        self._lock = threading.RLock()
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._create_tables()

    @_locked
    def _create_tables(self) -> None:
        self._db.executescript(
            """\
            CREATE TABLE IF NOT EXISTS notes (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT '',
                body        TEXT NOT NULL DEFAULT '',
                pinned      INTEGER NOT NULL DEFAULT 0,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes (updated_at);

            CREATE TABLE IF NOT EXISTS tasks (
                id            TEXT PRIMARY KEY,
                title         TEXT NOT NULL,
                notes         TEXT NOT NULL DEFAULT '',
                due           TEXT,
                priority      INTEGER NOT NULL DEFAULT 0,
                done          INTEGER NOT NULL DEFAULT 0,
                created_at    REAL NOT NULL,
                updated_at    REAL NOT NULL,
                completed_at  REAL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_done_due ON tasks (done, due);
            """
        )
        self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ------------------------------------------------------------------
    # Notes
    # ------------------------------------------------------------------

    @_locked
    def list_notes(self, query: str = "", limit: int = 200) -> List[Dict[str, Any]]:
        sql = "SELECT * FROM notes"
        params: list = []
        if query:
            # Escape LIKE wildcards so a search for "50%" is literal.
            esc = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            sql += " WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'"
            params += [f"%{esc}%", f"%{esc}%"]
        sql += " ORDER BY pinned DESC, updated_at DESC LIMIT ?"
        params.append(limit)
        return [_note(r) for r in self._db.execute(sql, params)]

    @_locked
    def get_note(self, note_id: str) -> Optional[Dict[str, Any]]:
        row = self._db.execute(
            "SELECT * FROM notes WHERE id = ?", (note_id,)
        ).fetchone()
        return _note(row) if row else None

    @_locked
    def create_note(
        self, title: str = "", body: str = "", pinned: bool = False
    ) -> Dict[str, Any]:
        now = time.time()
        note_id = uuid.uuid4().hex
        self._db.execute(
            "INSERT INTO notes (id, title, body, pinned, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, title, body, int(pinned), now, now),
        )
        self._db.commit()
        return self.get_note(note_id)  # type: ignore[return-value]

    @_locked
    def update_note(
        self, note_id: str, changes: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        fields = {k: v for k, v in changes.items() if k in NOTE_FIELDS}
        if "pinned" in fields:
            fields["pinned"] = int(bool(fields["pinned"]))
        if self.get_note(note_id) is None:
            return None
        if fields:
            fields["updated_at"] = time.time()
            assignments = ", ".join(f"{k} = ?" for k in fields)
            self._db.execute(
                f"UPDATE notes SET {assignments} WHERE id = ?",  # noqa: S608 - keys are whitelisted
                (*fields.values(), note_id),
            )
            self._db.commit()
        return self.get_note(note_id)

    @_locked
    def delete_note(self, note_id: str) -> bool:
        cur = self._db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        self._db.commit()
        return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    @_locked
    def list_tasks(
        self, status: str = "open", limit: int = 500
    ) -> List[Dict[str, Any]]:
        where = {"open": "WHERE done = 0", "done": "WHERE done = 1", "all": ""}[status]
        # Open tasks first; then by due date (undated last), priority, age.
        # Completed tasks list most recently finished first.
        order = (
            "ORDER BY done ASC,"
            " CASE WHEN done = 1 THEN -completed_at END ASC,"
            " due IS NULL, due ASC, priority DESC, created_at ASC"
        )
        sql = f"SELECT * FROM tasks {where} {order} LIMIT ?"  # noqa: S608 - fixed fragments
        return [_task(r) for r in self._db.execute(sql, (limit,))]

    @_locked
    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        row = self._db.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        return _task(row) if row else None

    @_locked
    def create_task(
        self,
        title: str,
        notes: str = "",
        due: Optional[str] = None,
        priority: int = 0,
    ) -> Dict[str, Any]:
        now = time.time()
        task_id = uuid.uuid4().hex
        self._db.execute(
            "INSERT INTO tasks"
            " (id, title, notes, due, priority, done, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            (task_id, title, notes, due, priority, now, now),
        )
        self._db.commit()
        return self.get_task(task_id)  # type: ignore[return-value]

    @_locked
    def update_task(
        self, task_id: str, changes: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        current = self.get_task(task_id)
        if current is None:
            return None
        fields = {k: v for k, v in changes.items() if k in TASK_FIELDS}
        if "done" in fields:
            done = bool(fields["done"])
            fields["done"] = int(done)
            # Stamp completion once; clear it when a task is reopened.
            if done and not current["done"]:
                fields["completed_at"] = time.time()
            elif not done:
                fields["completed_at"] = None
        if fields:
            fields["updated_at"] = time.time()
            assignments = ", ".join(f"{k} = ?" for k in fields)
            self._db.execute(
                f"UPDATE tasks SET {assignments} WHERE id = ?",  # noqa: S608 - keys are whitelisted
                (*fields.values(), task_id),
            )
            self._db.commit()
        return self.get_task(task_id)

    @_locked
    def delete_task(self, task_id: str) -> bool:
        cur = self._db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        self._db.commit()
        return cur.rowcount > 0

    @_locked
    def counts(self) -> Dict[str, int]:
        open_tasks = self._db.execute(
            "SELECT COUNT(*) FROM tasks WHERE done = 0"
        ).fetchone()[0]
        today = time.strftime("%Y-%m-%d")
        due_today = self._db.execute(
            "SELECT COUNT(*) FROM tasks"
            " WHERE done = 0 AND due IS NOT NULL AND due <= ?",
            (today,),
        ).fetchone()[0]
        notes = self._db.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        return {"open_tasks": open_tasks, "due_today": due_today, "notes": notes}

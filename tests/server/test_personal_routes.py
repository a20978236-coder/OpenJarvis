"""Tests for the /v1/personal notes & tasks API and its SQLite store."""

from __future__ import annotations

import datetime as dt
import os
import stat

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.server.api_routes import include_all_routes  # noqa: E402
from openjarvis.server.auth_middleware import AuthMiddleware  # noqa: E402
from openjarvis.server.personal_store import PersonalStore  # noqa: E402


@pytest.fixture
def store():
    s = PersonalStore(":memory:")
    yield s
    s.close()


@pytest.fixture
def client(store):
    app = FastAPI()
    include_all_routes(app)
    app.state.personal_store = store
    return TestClient(app)


# ----------------------------------------------------------------------
# Notes
# ----------------------------------------------------------------------


class TestNotes:
    def test_create_list_update_delete(self, client):
        r = client.post(
            "/v1/personal/notes", json={"title": "  Ideas  ", "body": "Build Jarvis"}
        )
        assert r.status_code == 201
        note = r.json()
        assert note["title"] == "Ideas"  # trimmed
        assert note["body"] == "Build Jarvis"
        assert note["pinned"] is False

        assert [n["id"] for n in client.get("/v1/personal/notes").json()["notes"]] == [
            note["id"]
        ]

        r = client.patch(f"/v1/personal/notes/{note['id']}", json={"pinned": True})
        assert r.status_code == 200
        assert r.json()["pinned"] is True
        assert r.json()["body"] == "Build Jarvis"  # untouched fields kept
        assert r.json()["updated_at"] >= note["updated_at"]

        assert client.delete(f"/v1/personal/notes/{note['id']}").status_code == 204
        assert client.get("/v1/personal/notes").json()["notes"] == []

    def test_rejects_empty_note(self, client):
        r = client.post("/v1/personal/notes", json={"title": "  ", "body": "  "})
        assert r.status_code == 422

    def test_body_only_note_is_allowed(self, client):
        assert (
            client.post(
                "/v1/personal/notes", json={"body": "quick thought"}
            ).status_code
            == 201
        )

    def test_pinned_first_then_most_recent(self, client):
        a = client.post("/v1/personal/notes", json={"title": "a"}).json()
        b = client.post("/v1/personal/notes", json={"title": "b"}).json()
        client.post("/v1/personal/notes", json={"title": "c"})
        client.patch(f"/v1/personal/notes/{a['id']}", json={"pinned": True})
        client.patch(f"/v1/personal/notes/{b['id']}", json={"body": "edited"})
        titles = [n["title"] for n in client.get("/v1/personal/notes").json()["notes"]]
        assert titles == ["a", "b", "c"]

    def test_search_matches_title_or_body_and_escapes_wildcards(self, client):
        client.post(
            "/v1/personal/notes", json={"title": "Groceries", "body": "milk, eggs"}
        )
        client.post(
            "/v1/personal/notes", json={"title": "Budget", "body": "save 50% more"}
        )
        client.post("/v1/personal/notes", json={"title": "Other", "body": "nothing"})

        def search(q):
            return [
                n["title"]
                for n in client.get("/v1/personal/notes", params={"q": q}).json()[
                    "notes"
                ]
            ]

        assert search("eggs") == ["Groceries"]
        assert search("budget") == ["Budget"]  # case-insensitive for ASCII
        assert search("50%") == ["Budget"]
        assert search("%") == ["Budget"]  # literal, not "match everything"

    def test_unknown_note_is_404(self, client):
        assert (
            client.patch("/v1/personal/notes/nope", json={"title": "x"}).status_code
            == 404
        )
        assert client.delete("/v1/personal/notes/nope").status_code == 404

    def test_length_limits(self, client):
        assert (
            client.post("/v1/personal/notes", json={"title": "x" * 201}).status_code
            == 422
        )
        assert (
            client.post(
                "/v1/personal/notes", json={"title": "t", "body": "x" * 20_001}
            ).status_code
            == 422
        )

    def test_cannot_overwrite_ids_or_timestamps(self, client):
        note = client.post("/v1/personal/notes", json={"title": "t"}).json()
        r = client.patch(
            f"/v1/personal/notes/{note['id']}",
            json={"id": "hacked", "created_at": 0, "title": "t2"},
        )
        assert r.json()["id"] == note["id"]
        assert r.json()["created_at"] == note["created_at"]


# ----------------------------------------------------------------------
# Tasks
# ----------------------------------------------------------------------


class TestTasks:
    def test_create_complete_reopen_delete(self, client):
        r = client.post(
            "/v1/personal/tasks",
            json={"title": "Call mum", "due": "2026-11-05", "priority": 2},
        )
        assert r.status_code == 201
        task = r.json()
        assert task["done"] is False and task["completed_at"] is None
        assert task["due"] == "2026-11-05"

        done = client.patch(
            f"/v1/personal/tasks/{task['id']}", json={"done": True}
        ).json()
        assert done["done"] is True and done["completed_at"] is not None
        assert client.get("/v1/personal/tasks").json()["tasks"] == []
        assert (
            len(
                client.get("/v1/personal/tasks", params={"status": "done"}).json()[
                    "tasks"
                ]
            )
            == 1
        )

        reopened = client.patch(
            f"/v1/personal/tasks/{task['id']}", json={"done": False}
        ).json()
        assert reopened["done"] is False and reopened["completed_at"] is None

        assert client.delete(f"/v1/personal/tasks/{task['id']}").status_code == 204
        assert (
            client.get("/v1/personal/tasks", params={"status": "all"}).json()["tasks"]
            == []
        )

    def test_completing_twice_keeps_first_completion_time(self, client):
        t = client.post("/v1/personal/tasks", json={"title": "x"}).json()
        first = client.patch(
            f"/v1/personal/tasks/{t['id']}", json={"done": True}
        ).json()["completed_at"]
        again = client.patch(
            f"/v1/personal/tasks/{t['id']}", json={"done": True}
        ).json()["completed_at"]
        assert again == first

    def test_open_tasks_sorted_by_due_then_priority(self, client):
        client.post("/v1/personal/tasks", json={"title": "undated-high", "priority": 2})
        client.post("/v1/personal/tasks", json={"title": "later", "due": "2026-12-01"})
        client.post(
            "/v1/personal/tasks", json={"title": "soon-low", "due": "2026-11-05"}
        )
        client.post(
            "/v1/personal/tasks",
            json={"title": "soon-high", "due": "2026-11-05", "priority": 2},
        )
        titles = [t["title"] for t in client.get("/v1/personal/tasks").json()["tasks"]]
        assert titles == ["soon-high", "soon-low", "later", "undated-high"]

    def test_clearing_due_date(self, client):
        t = client.post(
            "/v1/personal/tasks", json={"title": "x", "due": "2026-11-05"}
        ).json()
        r = client.patch(f"/v1/personal/tasks/{t['id']}", json={"due": None})
        assert r.json()["due"] is None

    @pytest.mark.parametrize(
        "body",
        [
            {"title": ""},
            {"title": "   "},
            {"title": "x", "due": "tomorrow"},
            {"title": "x", "due": "2026-13-40"},
            {"title": "x", "priority": 3},
            {"title": "x", "priority": -1},
            {},
        ],
    )
    def test_validation(self, client, body):
        assert client.post("/v1/personal/tasks", json=body).status_code == 422

    def test_bad_status_filter(self, client):
        assert (
            client.get(
                "/v1/personal/tasks", params={"status": "everything"}
            ).status_code
            == 422
        )

    def test_unknown_task_is_404(self, client):
        assert (
            client.patch("/v1/personal/tasks/nope", json={"done": True}).status_code
            == 404
        )
        assert client.delete("/v1/personal/tasks/nope").status_code == 404

    def test_summary_counts(self, client):
        today = dt.date.today().isoformat()
        client.post("/v1/personal/tasks", json={"title": "today", "due": today})
        client.post(
            "/v1/personal/tasks", json={"title": "overdue", "due": "2000-01-01"}
        )
        client.post("/v1/personal/tasks", json={"title": "future", "due": "2999-01-01"})
        done = client.post(
            "/v1/personal/tasks", json={"title": "done", "due": today}
        ).json()
        client.patch(f"/v1/personal/tasks/{done['id']}", json={"done": True})
        client.post("/v1/personal/notes", json={"title": "n"})
        assert client.get("/v1/personal/summary").json() == {
            "open_tasks": 3,
            "due_today": 2,
            "notes": 1,
        }


# ----------------------------------------------------------------------
# Security & persistence
# ----------------------------------------------------------------------


class TestSecurity:
    def test_requires_api_key_when_configured(self, store):
        app = FastAPI()
        include_all_routes(app)
        app.state.personal_store = store
        app.add_middleware(AuthMiddleware, api_key="s3cret")
        c = TestClient(app)

        assert c.get("/v1/personal/tasks").status_code == 401
        assert (
            c.post(
                "/v1/personal/notes",
                json={"title": "x"},
                headers={"Authorization": "Bearer wrong"},
            ).status_code
            == 401
        )
        ok = c.get("/v1/personal/tasks", headers={"Authorization": "Bearer s3cret"})
        assert ok.status_code == 200

    def test_sql_injection_in_ids_and_search_is_inert(self, client):
        client.post("/v1/personal/notes", json={"title": "keep me"})
        assert client.delete("/v1/personal/notes/' OR '1'='1").status_code == 404
        r = client.get("/v1/personal/notes", params={"q": "'; DROP TABLE notes; --"})
        assert r.status_code == 200
        assert len(client.get("/v1/personal/notes").json()["notes"]) == 1


def test_store_persists_to_owner_only_file(tmp_path):
    path = tmp_path / "sub" / "personal.db"
    s = PersonalStore(str(path))
    s.create_task("persist me")
    s.close()

    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    reopened = PersonalStore(str(path))
    assert [t["title"] for t in reopened.list_tasks()] == ["persist me"]
    reopened.close()


def test_default_location_is_openjarvis_home(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENJARVIS_HOME", str(tmp_path))
    s = PersonalStore()
    s.close()
    assert (tmp_path / "personal.db").exists()

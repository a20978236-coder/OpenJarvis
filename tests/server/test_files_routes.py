"""HELL Files: upload, list, download, delete, add to memory."""

from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.server import files_routes  # noqa: E402


class FakeMemory:
    backend_id = "fake"

    def __init__(self):
        self.docs = {}

    def store(self, content, *, source="", metadata=None):
        doc_id = f"d{len(self.docs) + 1}"
        self.docs[doc_id] = (content, source, metadata)
        return doc_id

    def delete(self, doc_id):
        return self.docs.pop(doc_id, None) is not None

    def count(self):
        return len(self.docs)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(files_routes, "_dir", lambda: tmp_path)
    app = FastAPI()
    app.include_router(files_routes.files_router)
    app.state.memory_backend = FakeMemory()
    c = TestClient(app)
    c.memory = app.state.memory_backend
    return c


def up(c, name, data, ctype="application/octet-stream"):
    return c.post("/v1/hell/files", files={"file": (name, data, ctype)})


def test_upload_list_download_delete(client, tmp_path):
    r = up(client, "notes.md", b"# Trip\nBook the train.")
    assert r.status_code == 201
    f = r.json()
    assert f["name"] == "notes.md" and f["size"] == 22 and f["can_add_to_memory"] is True
    assert (tmp_path / f["id"]).read_bytes() == b"# Trip\nBook the train."
    listing = client.get("/v1/hell/files").json()
    assert [x["id"] for x in listing["files"]] == [f["id"]]
    d = client.get(f"/v1/hell/files/{f['id']}")
    assert d.content == b"# Trip\nBook the train."
    assert d.headers["content-disposition"].startswith("attachment")
    assert d.headers["x-content-type-options"] == "nosniff"
    assert client.delete(f"/v1/hell/files/{f['id']}").status_code == 204
    assert client.get("/v1/hell/files").json()["files"] == []
    assert not (tmp_path / f["id"]).exists()


def test_html_and_svg_never_render_inline(client):
    for name in ("evil.html", "evil.svg"):
        f = up(client, name, b"<script>alert(1)</script>").json()
        d = client.get(f"/v1/hell/files/{f['id']}")
        assert d.headers["content-disposition"].startswith("attachment")
        assert d.headers["content-type"] == "application/octet-stream"


def test_images_preview_inline(client):
    f = up(client, "photo.png", b"\x89PNG\r\n\x1a\nxx").json()
    d = client.get(f"/v1/hell/files/{f['id']}")
    assert d.headers["content-disposition"].startswith("inline")
    assert d.headers["content-type"] == "image/png"


def test_names_are_cleaned_and_ids_validated(client, tmp_path):
    f = up(client, "../../etc/passwd", b"x").json()
    assert f["name"] == "passwd"
    assert client.get("/v1/hell/files/../index.json").status_code == 404
    assert client.get("/v1/hell/files/not-an-id").status_code == 404
    assert client.delete("/v1/hell/files/" + "0" * 32).status_code == 404


def test_limits(client, monkeypatch):
    monkeypatch.setattr(files_routes, "MAX_FILE_BYTES", 10)
    assert up(client, "big.txt", b"x" * 11).status_code == 413
    assert up(client, "empty.txt", b"").status_code == 400
    assert client.get("/v1/hell/files").json()["files"] == []


def test_add_to_memory_redacts_secrets_and_delete_removes_them(client):
    text = "Packing list: passport, charger.\n\nMy wifi password is hunter2"
    f = up(client, "trip.txt", text.encode()).json()
    r = client.post(f"/v1/hell/files/{f['id']}/memory").json()
    assert r["in_memory"] is True and r["secrets_removed"] == 1
    stored = " ".join(c for c, _, _ in client.memory.docs.values())
    assert "Packing list: passport, charger." in stored
    assert "hunter2" not in stored and "[secret removed]" in stored
    # Re-adding replaces rather than duplicates.
    client.post(f"/v1/hell/files/{f['id']}/memory")
    assert client.memory.count() == 1
    client.delete(f"/v1/hell/files/{f['id']}")
    assert client.memory.count() == 0


def test_remove_from_memory_keeps_the_file(client):
    f = up(client, "a.md", b"Remember the milk").json()
    client.post(f"/v1/hell/files/{f['id']}/memory")
    r = client.delete(f"/v1/hell/files/{f['id']}/memory").json()
    assert r["in_memory"] is False and client.memory.count() == 0
    assert client.get(f"/v1/hell/files/{f['id']}").status_code == 200


def test_unreadable_types_are_refused_for_memory(client):
    f = up(client, "song.mp3", b"ID3....").json()
    assert f["can_add_to_memory"] is False
    assert client.post(f"/v1/hell/files/{f['id']}/memory").status_code == 415

"""Pre-compressed static files and caching for the HELL app."""

from __future__ import annotations

import gzip

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.server.static_compress import (  # noqa: E402
    CompressedAssets,
    _accepts,
    compressed_file_response,
)  # noqa: E402


@pytest.fixture
def app_dir(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    body = b"console.log('hell');" * 200
    (assets / "app-abc123.js").write_bytes(body)
    (assets / "app-abc123.js.gz").write_bytes(gzip.compress(body))
    (assets / "app-abc123.js.br").write_bytes(b"BR-COPY")
    (assets / "plain.css").write_bytes(b"a{}")
    return tmp_path, body


def _client(root):
    app = FastAPI()
    app.mount("/assets", CompressedAssets(directory=root / "assets"))
    return TestClient(app)


def test_brotli_preferred_then_gzip_then_plain(app_dir):
    root, body = app_dir
    c = _client(root)
    r = c.get("/assets/app-abc123.js", headers={"Accept-Encoding": "gzip, br"})
    assert r.headers["content-encoding"] == "br"
    assert r.headers["content-type"].startswith(
        ("application/javascript", "text/javascript")
    )
    assert (
        "immutable" in r.headers["cache-control"]
        and r.headers["vary"] == "Accept-Encoding"
    )
    r = c.get("/assets/app-abc123.js", headers={"Accept-Encoding": "gzip"})
    assert (
        r.headers["content-encoding"] == "gzip" and r.content == body
    )  # client decodes
    r = c.get("/assets/app-abc123.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in r.headers and r.content == body


def test_refused_encodings_and_missing_copies(app_dir):
    root, _ = app_dir
    c = _client(root)
    r = c.get("/assets/app-abc123.js", headers={"Accept-Encoding": "br;q=0, gzip"})
    assert r.headers["content-encoding"] == "gzip"
    r = c.get("/assets/plain.css", headers={"Accept-Encoding": "br"})
    assert "content-encoding" not in r.headers and r.content == b"a{}"
    assert c.get("/assets/nope.js").status_code == 404


def test_accepts_parser():
    assert _accepts("gzip, deflate, br") == {"gzip", "deflate", "br"}
    assert _accepts("br;q=0, gzip;q=0.5") == {"gzip"}
    assert _accepts("") == set()


def test_spa_files_keep_no_cache(tmp_path):
    f = tmp_path / "index.html"
    f.write_text("<html>")
    (tmp_path / "index.html.br").write_bytes(b"x")
    r = compressed_file_response(f, "br", {"Cache-Control": "no-cache"})
    assert (
        r.headers["content-encoding"] == "br"
        and r.headers["cache-control"] == "no-cache"
    )
    assert r.media_type == "text/html"

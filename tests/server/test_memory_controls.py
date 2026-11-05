"""HELL memory controls: approval, remember, clear, switch off."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.memory.service import MemoryService  # noqa: E402
from openjarvis.memory.store import TRUST_AUTO, TRUST_PENDING, LocalFactStore  # noqa: E402
from openjarvis.server import memory_controls  # noqa: E402
from openjarvis.server.api_routes import include_all_routes  # noqa: E402
from openjarvis.server.memory_controls import (  # noqa: E402
    init_memory_controls,
    memory_controls_router,
)


class FakeExtractor:
    def __init__(self, facts):
        self.facts = facts

    def extract(self, user_text, assistant_text=""):
        return list(self.facts)


@pytest.fixture(autouse=True)
def prefs_file(tmp_path, monkeypatch):
    path = tmp_path / "memory_prefs.json"
    monkeypatch.setattr(memory_controls, "_prefs_path", lambda: path)
    return path


def _app(tmp_path, svc=None, *, engine=None, model=""):
    app = FastAPI()
    app.include_router(memory_controls_router)
    include_all_routes(app)
    app.state.config = SimpleNamespace(
        memory=SimpleNamespace(backend="local", facts_path=str(tmp_path / "facts.jsonl"), max_facts=100, extraction_model="")
    )
    app.state.engine = engine
    app.state.model = model
    app.state.bus = None
    app.state.memory_service = svc
    init_memory_controls(app)
    return app, TestClient(app)


def test_ask_mode_keeps_learned_facts_pending_until_approved(tmp_path):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    svc = MemoryService(store, FakeExtractor(["User prefers dark mode"]))
    app, c = _app(tmp_path, svc)
    assert c.get("/v1/memory/settings").json()["learning"] == "ask"  # HELL default
    svc._process(("I like dark mode", ""))
    facts = store.list()
    assert facts[0].trust == TRUST_PENDING and not facts[0].trusted_for_recall
    assert c.get("/v1/memory/settings").json()["facts"]["pending"] == 1
    r = c.post("/v1/memory/facts/approve", json={"index": 0, "text": "User prefers dark mode"})
    assert r.status_code == 200
    assert store.list()[0].trusted_for_recall
    # Approving again is a conflict, not a silent success.
    assert c.post("/v1/memory/facts/approve", json={"index": 0, "text": "User prefers dark mode"}).status_code == 409


def test_auto_mode_still_holds_personal_details_and_drops_secrets(tmp_path):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    svc = MemoryService(
        store,
        FakeExtractor(["User prefers tea", "User was diagnosed with asthma", "User's password is hunter2"]),
        approval="auto",
    )
    svc._process(("...", ""))
    by_text = {f.text: f.trust for f in store.list()}
    assert by_text == {"User prefers tea": TRUST_AUTO, "User was diagnosed with asthma": TRUST_PENDING}


def test_relearning_an_approved_fact_does_not_demote_it(tmp_path):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    svc = MemoryService(store, FakeExtractor(["User prefers tea"]), approval="ask")
    svc._process(("a", ""))
    assert svc.approve_fact(0, "User prefers tea")
    svc._process(("b", ""))
    assert store.list()[0].trusted_for_recall


def test_remember_this_is_trusted_and_refuses_secrets(tmp_path):
    app, c = _app(tmp_path)  # no learner configured at all
    r = c.post("/v1/memory/facts/remember", json={"text": "My daughter's name is Mia"})
    assert r.status_code == 200 and r.json()["status"] == "stored"
    facts = c.get("/v1/memory/facts").json()["facts"]
    assert facts[0]["recallable"] is True and facts[0]["source"] == "user"
    bad = c.post("/v1/memory/facts/remember", json={"text": "my pin is 4421"})
    assert bad.status_code == 422
    assert len(c.get("/v1/memory/facts").json()["facts"]) == 1


def test_remember_approves_a_pending_duplicate(tmp_path):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    store.add_with_trust("User prefers tea", source="auto", trust=TRUST_PENDING)
    svc = MemoryService(store, None)
    assert svc.remember("user prefers tea") is True
    assert store.list()[0].trusted_for_recall


def test_switching_learning_off_and_on_persists(tmp_path, prefs_file):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    svc = MemoryService(store, FakeExtractor(["x"]))
    app, c = _app(tmp_path, svc)
    body = c.put("/v1/memory/settings", json={"learning": "off", "use_in_replies": False}).json()
    assert body["learning"] == "off" and body["use_in_replies"] is False
    assert svc.paused and app.state.memory_use_in_replies is False
    assert prefs_file.exists()
    # A restart reads the saved choice.
    app2, c2 = _app(tmp_path, MemoryService(store, FakeExtractor(["x"])))
    assert c2.get("/v1/memory/settings").json()["learning"] == "off"
    assert app2.state.memory_service.paused
    assert c.put("/v1/memory/settings", json={"learning": "loud"}).status_code == 422


def test_paused_service_ignores_new_conversations(tmp_path):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    svc = MemoryService(store, FakeExtractor(["x"]))
    svc.start()
    try:
        svc.set_paused(True)
        assert svc.submit("hello", "hi") is False
        svc.set_paused(False)
        assert svc.submit("hello", "hi") is True
    finally:
        svc.stop()


def test_turning_learning_on_without_a_model_is_refused(tmp_path):
    app, c = _app(tmp_path)
    r = c.put("/v1/memory/settings", json={"learning": "ask"})
    assert r.status_code == 409


def test_clear_facts(tmp_path):
    store = LocalFactStore(tmp_path / "facts.jsonl")
    store.add("a")
    store.add("b")
    app, c = _app(tmp_path, MemoryService(store, None))
    assert c.post("/v1/memory/facts/clear").json() == {"cleared": 2}
    assert store.list() == []


def test_disabled_memory_is_not_injected_into_replies(tmp_path):
    from openjarvis.server import routes

    src = open(routes.__file__, encoding="utf-8").read()
    assert 'getattr(request.app.state, "memory_use_in_replies", True)' in src

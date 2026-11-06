"""Camera vision: image parts in /v1/chat/completions and /v1/hell/vision."""

from __future__ import annotations

import base64

import httpx
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.server import vision  # noqa: E402
from openjarvis.server.app import create_app  # noqa: E402

# Smallest valid images of each accepted type.
JPEG = base64.b64encode(b"\xff\xd8\xff\xe0" + b"\x00" * 32).decode()
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32).decode()
WEBP = base64.b64encode(b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 16).decode()


def _parts(text, *images, mime="image/jpeg"):
    return [{"type": "text", "text": text}] + [
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{i}"}}
        for i in images
    ]


class FakeOllama:
    """Ollama-like engine that records what it was asked."""

    engine_id = "ollama"

    def __init__(self, capabilities):
        self._host = "http://fake-ollama"
        caps = capabilities

        def handler(req: httpx.Request):
            name = __import__("json").loads(req.content)["model"]
            return httpx.Response(
                200, json={"capabilities": caps.get(name, ["completion"])}
            )

        self._client = httpx.Client(
            base_url=self._host, transport=httpx.MockTransport(handler)
        )
        self.calls = []

    def health(self):
        return True

    def list_models(self):
        return ["llava:7b", "qwen3:8b"]

    def generate(self, messages, *, model, **kw):
        self.calls.append(messages)
        return {
            "content": "I see a red mug.",
            "usage": {},
            "model": model,
            "finish_reason": "stop",
        }

    async def stream(self, messages, *, model, **kw):
        self.calls.append(messages)
        for t in ["I see", " a mug."]:
            yield t


class FakeOther(FakeOllama):
    engine_id = "openai"


def _config():
    from openjarvis.core.config import JarvisConfig

    cfg = JarvisConfig()
    cfg.analytics.enabled = False
    cfg.traces.enabled = False
    cfg.security.enabled = False
    cfg.agent.context_from_memory = False
    return cfg


@pytest.fixture(autouse=True)
def _clear_cache():
    vision._cap_cache.clear()
    yield
    vision._cap_cache.clear()


def _client(engine, agent=None):
    return TestClient(create_app(engine, "llava:7b", agent=agent, config=_config()))


# ----------------------------------------------------------------------
# Content parsing
# ----------------------------------------------------------------------


class TestSplitContent:
    def test_text_and_images(self):
        text, images = vision.split_content(_parts("what is this?", JPEG, PNG))
        assert text == "what is this?"
        assert images == [JPEG, PNG]
        assert vision.split_content(_parts("x", WEBP, mime="image/webp"))[1] == [WEBP]

    def test_plain_string_untouched(self):
        assert vision.split_content("hello") == ("hello", [])

    @pytest.mark.parametrize(
        "content",
        [
            [{"type": "image_url", "image_url": {"url": "https://evil.example/x.jpg"}}],
            [{"type": "image_url", "image_url": {"url": "file:///etc/passwd"}}],
            [
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/svg+xml;base64,PHN2Zz4="},
                }
            ],
            [
                {
                    "type": "image_url",
                    "image_url": {"url": "data:image/jpeg;base64,!!notbase64!!"},
                }
            ],
            [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/jpeg;base64,"
                        + base64.b64encode(b"GIF89a....").decode()
                    },
                }
            ],
            [{"type": "audio", "data": "x"}],
            "x"
            and [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{JPEG}"},
                }
            ]
            * 5,
        ],
    )
    def test_rejects_unsafe_or_invalid(self, content):
        with pytest.raises(ValueError):
            vision.split_content(content)

    def test_size_limit(self, monkeypatch):
        monkeypatch.setattr(vision, "MAX_IMAGE_BYTES", 10)
        with pytest.raises(ValueError, match="too large"):
            vision.split_content(_parts("x", JPEG))


# ----------------------------------------------------------------------
# Chat route
# ----------------------------------------------------------------------


class TestChatWithImages:
    def test_images_reach_a_vision_model(self):
        engine = FakeOllama({"llava:7b": ["completion", "vision"]})
        r = _client(engine).post(
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "messages": [
                    {"role": "user", "content": _parts("What am I looking at?", JPEG)}
                ],
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["choices"][0]["message"]["content"] == "I see a red mug."
        user = [m for m in engine.calls[0] if m.role.value == "user"][-1]
        assert user.content == "What am I looking at?"
        assert user.images == [JPEG]

    def test_streaming_also_carries_images(self):
        engine = FakeOllama({"llava:7b": ["vision"]})
        with _client(engine).stream(
            "POST",
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "stream": True,
                "messages": [
                    {"role": "user", "content": _parts("read this sign", PNG)}
                ],
            },
        ) as r:
            body = "".join(r.iter_text())
        assert r.status_code == 200
        assert "mug" in body
        assert [m for m in engine.calls[0] if m.role.value == "user"][-1].images == [
            PNG
        ]

    def test_only_the_latest_user_message_keeps_images(self):
        engine = FakeOllama({"llava:7b": ["vision"]})
        _client(engine).post(
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "messages": [
                    {"role": "user", "content": _parts("old", JPEG)},
                    {"role": "assistant", "content": "ok"},
                    {"role": "user", "content": _parts("new", PNG)},
                ],
            },
        )
        users = [m for m in engine.calls[0] if m.role.value == "user"]
        assert users[0].images is None and users[-1].images == [PNG]

    def test_non_vision_model_is_refused_not_faked(self):
        engine = FakeOllama({"llava:7b": ["completion"]})
        r = _client(engine).post(
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "messages": [{"role": "user", "content": _parts("what is this", JPEG)}],
            },
        )
        assert r.status_code == 400
        assert "can't see images" in r.json()["detail"]
        assert engine.calls == []  # never asked the model

    def test_engine_without_image_support_is_refused(self):
        engine = FakeOther({"llava:7b": ["vision"]})
        r = _client(engine).post(
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "messages": [{"role": "user", "content": _parts("what is this", JPEG)}],
            },
        )
        assert r.status_code == 400
        assert "can't receive images" in r.json()["detail"]

    def test_images_bypass_a_text_only_agent(self):
        from unittest.mock import MagicMock

        engine = FakeOllama({"llava:7b": ["vision"]})
        agent = MagicMock()
        agent.agent_id = "mock"
        r = _client(engine, agent=agent).post(
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "messages": [{"role": "user", "content": _parts("what is this", JPEG)}],
            },
        )
        assert r.status_code == 200
        agent.run.assert_not_called()
        assert engine.calls

    def test_bad_image_is_422(self):
        engine = FakeOllama({"llava:7b": ["vision"]})
        r = _client(engine).post(
            "/v1/chat/completions",
            json={
                "model": "llava:7b",
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": "https://x/y.jpg"},
                            }
                        ],
                    }
                ],
            },
        )
        assert r.status_code == 422
        assert engine.calls == []

    def test_text_only_requests_unchanged(self):
        engine = FakeOther({})
        r = _client(engine).post(
            "/v1/chat/completions",
            json={"model": "llava:7b", "messages": [{"role": "user", "content": "hi"}]},
        )
        assert r.status_code == 200


# ----------------------------------------------------------------------
# Status endpoint
# ----------------------------------------------------------------------


class TestVisionStatus:
    def test_reports_capable_models(self):
        engine = FakeOllama({"llava:7b": ["completion", "vision"]})
        body = (
            _client(engine).get("/v1/hell/vision", params={"model": "qwen3:8b"}).json()
        )
        assert body["model_sees"] is False
        assert body["engine_accepts"] is True
        assert body["vision_models"] == ["llava:7b"]
        assert "qwen2.5vl" in body["hint"]

    def test_unknown_capability_is_null_not_false(self):
        engine = FakeOllama({})

        def boom(req):
            raise httpx.ConnectError("down", request=req)

        engine._client = httpx.Client(
            base_url="http://x", transport=httpx.MockTransport(boom)
        )
        body = (
            _client(engine).get("/v1/hell/vision", params={"model": "llava:7b"}).json()
        )
        assert body["model_sees"] is None

    def test_unwraps_guardrails_and_multi_engine(self):
        class Multi:
            engine_id = "multi"

            def __init__(self, inner):
                self.inner = inner

            def _engine_for(self, model):
                return self.inner

        class Guard:
            engine_id = "guardrails"

            def __init__(self, inner):
                self._engine = inner

        real = FakeOllama({"llava:7b": ["vision"]})
        wrapped = Guard(Multi(real))
        assert vision.resolve_engine(wrapped, "llava:7b") is real
        assert vision.engine_accepts_images(wrapped, "llava:7b")

    def test_unwraps_the_real_server_stack(self):
        """Same nesting `jarvis serve` builds: Guardrails > Instrumented > Multi."""
        from openjarvis.core.events import EventBus
        from openjarvis.engine.multi import MultiEngine
        from openjarvis.security.guardrails import GuardrailsEngine
        from openjarvis.telemetry.instrumented_engine import InstrumentedEngine

        real = FakeOllama({"llava:7b": ["vision"]})
        multi = MultiEngine([("ollama", real)])
        stack = GuardrailsEngine(InstrumentedEngine(multi, EventBus()))
        assert vision.resolve_engine(stack, "llava:7b") is real
        assert vision.engine_accepts_images(stack, "llava:7b")
        assert vision.model_sees_images(stack, "llava:7b") is True

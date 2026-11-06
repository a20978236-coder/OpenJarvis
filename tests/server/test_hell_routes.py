"""Tests for the HELL dashboard weather proxy (Open-Meteo, mocked)."""

from __future__ import annotations

import httpx
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from openjarvis.server import hell_routes  # noqa: E402
from openjarvis.server.api_routes import include_all_routes  # noqa: E402
from openjarvis.server.auth_middleware import AuthMiddleware  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_cache():
    hell_routes._cache.clear()
    yield
    hell_routes._cache.clear()


def _app(handler, api_key=""):
    calls = []

    def recording(request: httpx.Request):
        calls.append(request)
        return handler(request)

    app = FastAPI()
    include_all_routes(app)
    app.state.hell_http_transport = httpx.MockTransport(recording)
    if api_key:
        app.add_middleware(AuthMiddleware, api_key=api_key)
    return TestClient(app), calls


def _ok(request: httpx.Request) -> httpx.Response:
    if request.url.host.startswith("geocoding"):
        name = request.url.params["name"]
        if name.lower() == "atlantis":
            return httpx.Response(200, json={"results": []})
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "name": "Leeds",
                        "country_code": "GB",
                        "latitude": 53.7997,
                        "longitude": -1.5492,
                    }
                ]
            },
        )
    return httpx.Response(
        200,
        json={"current": {"temperature_2m": 71.6, "weather_code": 2, "is_day": 1}},
    )


def test_weather_by_coordinates_rounds_location():
    c, calls = _app(_ok)
    r = c.get("/v1/hell/weather", params={"lat": 53.799712, "lon": -1.549245})
    assert r.status_code == 200
    body = r.json()
    assert body["temperature"] == 72
    assert body["label"] == "Partly cloudy"
    assert body["icon"] == "partly"
    assert body["units"] == "f"
    sent = calls[0].url.params
    assert (
        sent["latitude"] == "53.8" and sent["longitude"] == "-1.55"
    )  # ~1 km, not exact
    assert sent["temperature_unit"] == "fahrenheit"


def test_weather_by_city_and_celsius():
    c, calls = _app(_ok)
    r = c.get("/v1/hell/weather", params={"city": "Leeds", "units": "c"})
    assert r.status_code == 200
    assert r.json()["place"] == "Leeds, GB"
    assert calls[-1].url.params["temperature_unit"] == "celsius"


def test_results_are_cached():
    c, calls = _app(_ok)
    c.get("/v1/hell/weather", params={"lat": 10, "lon": 10})
    c.get("/v1/hell/weather", params={"lat": 10.001, "lon": 10.002})  # same ~1 km cell
    assert len(calls) == 1


def test_unknown_city_is_404():
    c, _ = _app(_ok)
    assert c.get("/v1/hell/weather", params={"city": "Atlantis"}).status_code == 404


def test_upstream_failure_is_502_not_a_crash():
    c, _ = _app(lambda req: httpx.Response(503, text="down"))
    r = c.get("/v1/hell/weather", params={"lat": 1, "lon": 1})
    assert r.status_code == 502
    assert r.json()["detail"] == "Weather service unavailable"

    def boom(req):
        raise httpx.ConnectError("no network", request=req)

    c2, _ = _app(boom)
    assert c2.get("/v1/hell/weather", params={"lat": 2, "lon": 2}).status_code == 502


def test_malformed_upstream_data_is_502():
    c, _ = _app(lambda req: httpx.Response(200, json={"current": {}}))
    assert c.get("/v1/hell/weather", params={"lat": 3, "lon": 3}).status_code == 502


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"lat": 1},
        {"lat": 91, "lon": 0},
        {"lat": 0, "lon": 181},
        {"city": "x"},
        {"lat": 0, "lon": 0, "units": "k"},
    ],
)
def test_validation(params):
    c, calls = _app(_ok)
    assert c.get("/v1/hell/weather", params=params).status_code == 422
    assert calls == []


def test_requires_api_key_when_configured():
    c, _ = _app(_ok, api_key="k")
    assert c.get("/v1/hell/weather", params={"lat": 1, "lon": 1}).status_code == 401
    ok = c.get(
        "/v1/hell/weather",
        params={"lat": 1, "lon": 1},
        headers={"Authorization": "Bearer k"},
    )
    assert ok.status_code == 200


def test_every_wmo_code_has_a_label():
    for code in [0, 1, 2, 3, 45, 61, 71, 80, 95, 99]:
        label, icon = hell_routes.describe_weather(code)
        assert label != "Unknown" and icon
    assert hell_routes.describe_weather(1234) == ("Unknown", "cloud")


class _Engine:
    engine_id = "ollama"

    def health(self):
        return True

    def list_models(self):
        return ["a", "b"]


def test_diagnostics_reports_server_side_state(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from openjarvis.server import hell_routes

    app = FastAPI()
    app.include_router(hell_routes.hell_router)
    app.state.engine = _Engine()
    app.state.engine_name = "ollama"
    app.state.model = "qwen3:8b"
    app.state.memory_prefs = {"learning": "ask"}
    app.state.hell_http_transport = httpx.MockTransport(
        lambda req: httpx.Response(200, json={})
    )
    body = TestClient(app).get("/v1/hell/diagnostics").json()
    assert body["ai"] == {
        "engine": "ollama",
        "model": "qwen3:8b",
        "healthy": True,
        "models": 2,
        "latency_ms": body["ai"]["latency_ms"],
    }
    assert body["internet"]["ok"] is True
    assert body["memory"]["learning"] == "ask"
    assert body["voice"] == {"stt": "", "tts": None}


def test_diagnostics_without_internet(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from openjarvis.server import hell_routes

    def boom(req):
        raise httpx.ConnectError("no route")

    app = FastAPI()
    app.include_router(hell_routes.hell_router)
    app.state.hell_http_transport = httpx.MockTransport(boom)
    body = TestClient(app).get("/v1/hell/diagnostics").json()
    assert body["internet"] == {"ok": False, "error": "ConnectError"}
    assert body["ai"]["healthy"] is False

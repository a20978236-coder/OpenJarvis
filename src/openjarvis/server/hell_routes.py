"""``/v1/hell/*`` — small helpers for the HELL mobile dashboard.

``GET /v1/hell/weather`` proxies Open-Meteo (free, no API key) so the phone
never talks to a third party directly and the page's Content-Security-Policy
can stay ``'self'``-only. Privacy: coordinates are rounded to ~1 km before
they leave the server, and results are cached for 10 minutes.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Literal, Optional, Tuple

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

logger = logging.getLogger(__name__)

hell_router = APIRouter(prefix="/v1/hell", tags=["hell"])

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
CACHE_TTL = 600.0
_CACHE_MAX = 64
_cache: Dict[Tuple[Any, ...], Tuple[float, Dict[str, Any]]] = {}

# WMO weather interpretation codes -> (label, icon key for the UI).
_WMO: Dict[int, Tuple[str, str]] = {
    0: ("Clear", "clear"),
    1: ("Mostly clear", "clear"),
    2: ("Partly cloudy", "partly"),
    3: ("Overcast", "cloud"),
    45: ("Fog", "fog"),
    48: ("Freezing fog", "fog"),
    51: ("Light drizzle", "drizzle"),
    53: ("Drizzle", "drizzle"),
    55: ("Heavy drizzle", "drizzle"),
    56: ("Freezing drizzle", "drizzle"),
    57: ("Freezing drizzle", "drizzle"),
    61: ("Light rain", "rain"),
    63: ("Rain", "rain"),
    65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "rain"),
    67: ("Freezing rain", "rain"),
    71: ("Light snow", "snow"),
    73: ("Snow", "snow"),
    75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"),
    80: ("Showers", "rain"),
    81: ("Showers", "rain"),
    82: ("Heavy showers", "rain"),
    85: ("Snow showers", "snow"),
    86: ("Snow showers", "snow"),
    95: ("Thunderstorm", "storm"),
    96: ("Thunderstorm, hail", "storm"),
    99: ("Thunderstorm, hail", "storm"),
}


def describe_weather(code: int) -> Tuple[str, str]:
    return _WMO.get(int(code), ("Unknown", "cloud"))


def _cache_get(key: Tuple[Any, ...]) -> Optional[Dict[str, Any]]:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_TTL:
        return hit[1]
    return None


def _cache_put(key: Tuple[Any, ...], value: Dict[str, Any]) -> None:
    if len(_cache) >= _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)
    _cache[key] = (time.monotonic(), value)


def _client(request: Request) -> httpx.AsyncClient:
    # Tests inject a MockTransport; production uses the default network stack.
    transport = getattr(request.app.state, "hell_http_transport", None)
    return httpx.AsyncClient(timeout=6.0, transport=transport)


@hell_router.get("/weather")
async def weather(
    request: Request,
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    city: Optional[str] = Query(None, min_length=2, max_length=80),
    units: Literal["f", "c"] = "f",
):
    """Current conditions for a place (city name) or rounded coordinates."""
    if city is None and (lat is None or lon is None):
        raise HTTPException(status_code=422, detail="Give a city, or both lat and lon")

    place: Optional[str] = None
    async with _client(request) as client:
        try:
            if city is not None:
                city = city.strip()
                ckey = ("geo", city.lower())
                geo = _cache_get(ckey)
                if geo is None:
                    r = await client.get(GEOCODE_URL, params={"name": city, "count": 1})
                    r.raise_for_status()
                    results = (r.json() or {}).get("results") or []
                    if not results:
                        raise HTTPException(
                            status_code=404, detail=f"Couldn't find {city!r}"
                        )
                    top = results[0]
                    geo = {
                        "lat": float(top["latitude"]),
                        "lon": float(top["longitude"]),
                        "place": ", ".join(
                            p for p in (top.get("name"), top.get("country_code")) if p
                        ),
                    }
                    _cache_put(ckey, geo)
                lat, lon, place = geo["lat"], geo["lon"], geo["place"]

            # ~1 km precision is plenty for weather and avoids sharing exact location.
            rlat, rlon = round(float(lat), 2), round(float(lon), 2)
            wkey = ("wx", rlat, rlon, units)
            cached = _cache_get(wkey)
            if cached is not None:
                return {**cached, "place": place or cached.get("place")}

            r = await client.get(
                FORECAST_URL,
                params={
                    "latitude": rlat,
                    "longitude": rlon,
                    "current": "temperature_2m,weather_code,is_day",
                    "temperature_unit": "fahrenheit" if units == "f" else "celsius",
                },
            )
            r.raise_for_status()
            current = (r.json() or {}).get("current") or {}
            temp = current.get("temperature_2m")
            code = current.get("weather_code")
            if temp is None or code is None:
                raise HTTPException(
                    status_code=502, detail="Weather service sent no data"
                )
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            logger.warning("Weather lookup failed: %s", exc)
            raise HTTPException(
                status_code=502, detail="Weather service unavailable"
            ) from exc

    label, icon = describe_weather(int(code))
    result = {
        "temperature": round(float(temp)),
        "units": units,
        "code": int(code),
        "label": label,
        "icon": icon,
        "is_day": bool(current.get("is_day", 1)),
        "place": place,
        "updated_at": time.time(),
    }
    _cache_put(wkey, result)
    return result

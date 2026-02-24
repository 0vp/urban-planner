"""Shared data providers and cache utilities for simulation enrichment."""

from __future__ import annotations

import math
import time
from threading import Lock
from typing import Any, Optional

import httpx


OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
NWS_POINTS_URL = "https://api.weather.gov/points/{lat},{lon}"
CACHE_TTL_SECONDS = 600


def _round_coord(value: float, precision: int = 2) -> float:
    return round(float(value), precision)


def _parse_wind_speed_kmh(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and math.isfinite(raw):
        return float(raw)
    if isinstance(raw, str):
        digits = "".join(ch for ch in raw if ch.isdigit() or ch in {".", "-"})
        if not digits:
            return None
        try:
            mph = float(digits)
        except ValueError:
            return None
        if not math.isfinite(mph):
            return None
        return mph * 1.60934
    return None


def _confidence_from_completeness(current: dict[str, Any], source_count: int) -> float:
    expected = [
        "temperature_c",
        "precipitation_mm",
        "cloud_cover_pct",
        "wind_speed_kmh",
        "wind_direction_deg",
    ]
    filled = sum(1 for key in expected if isinstance(current.get(key), (int, float)))
    completeness = filled / len(expected)
    source_boost = min(0.2, source_count * 0.1)
    return round(max(0.2, min(0.99, 0.45 + completeness * 0.35 + source_boost)), 3)


class TimedCache:
    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._values: dict[str, tuple[float, Any]] = {}
        self._lock = Lock()

    def get(self, key: str) -> Any:
        now = time.time()
        with self._lock:
            entry = self._values.get(key)
            if entry is None:
                return None
            ts, value = entry
            if now - ts > self._ttl:
                self._values.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._values[key] = (time.time(), value)


class OpenMeteoProvider:
    async def fetch(self, lat: float, lon: float) -> Optional[dict[str, Any]]:
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,uv_index",
            "hourly": "temperature_2m,wind_speed_10m,precipitation,cloud_cover,shortwave_radiation",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset",
            "forecast_days": 7,
            "timezone": "auto",
        }
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                response = await client.get(OPEN_METEO_FORECAST_URL, params=params)
                response.raise_for_status()
                payload = response.json()
        except Exception:
            return None

        current_raw = payload.get("current", {})
        hourly_raw = payload.get("hourly", {})
        daily_raw = payload.get("daily", {})

        current = {
            "temperature_c": current_raw.get("temperature_2m"),
            "feels_like_c": current_raw.get("apparent_temperature"),
            "humidity_pct": current_raw.get("relative_humidity_2m"),
            "precipitation_mm": current_raw.get("precipitation"),
            "cloud_cover_pct": current_raw.get("cloud_cover"),
            "wind_speed_kmh": current_raw.get("wind_speed_10m"),
            "wind_direction_deg": current_raw.get("wind_direction_10m"),
            "wind_gusts_kmh": current_raw.get("wind_gusts_10m"),
            "surface_pressure_hpa": current_raw.get("surface_pressure"),
            "uv_index": current_raw.get("uv_index"),
            "shortwave_radiation_wm2": None,
        }
        if isinstance(hourly_raw.get("shortwave_radiation"), list) and hourly_raw["shortwave_radiation"]:
            first = hourly_raw["shortwave_radiation"][0]
            if isinstance(first, (int, float)) and math.isfinite(first):
                current["shortwave_radiation_wm2"] = float(first)

        return {
            "provider": "open-meteo",
            "current": current,
            "hourly": {
                "time": hourly_raw.get("time", []),
                "temperature_c": hourly_raw.get("temperature_2m", []),
                "wind_speed_kmh": hourly_raw.get("wind_speed_10m", []),
                "precipitation_mm": hourly_raw.get("precipitation", []),
                "cloud_cover_pct": hourly_raw.get("cloud_cover", []),
                "shortwave_radiation_wm2": hourly_raw.get("shortwave_radiation", []),
            },
            "daily": {
                "dates": daily_raw.get("time", []),
                "temp_max_c": daily_raw.get("temperature_2m_max", []),
                "temp_min_c": daily_raw.get("temperature_2m_min", []),
                "precipitation_mm": daily_raw.get("precipitation_sum", []),
                "wind_max_kmh": daily_raw.get("wind_speed_10m_max", []),
                "uv_max": daily_raw.get("uv_index_max", []),
                "sunrise": daily_raw.get("sunrise", []),
                "sunset": daily_raw.get("sunset", []),
            },
        }


class NwsProvider:
    def _is_supported(self, lat: float, lon: float) -> bool:
        return 18 <= lat <= 72 and -170 <= lon <= -60

    async def fetch(self, lat: float, lon: float) -> Optional[dict[str, Any]]:
        if not self._is_supported(lat, lon):
            return None

        headers = {"User-Agent": "urban-planner/1.0"}
        try:
            async with httpx.AsyncClient(timeout=2.2, headers=headers) as client:
                points_response = await client.get(NWS_POINTS_URL.format(lat=lat, lon=lon))
                points_response.raise_for_status()
                points_payload = points_response.json()
                forecast_url = points_payload.get("properties", {}).get("forecastHourly")
                if not forecast_url:
                    return None

                hourly_response = await client.get(forecast_url)
                hourly_response.raise_for_status()
                hourly_payload = hourly_response.json()
        except Exception:
            return None

        periods = hourly_payload.get("properties", {}).get("periods", [])
        if not periods:
            return None
        first = periods[0]
        wind_speed_kmh = _parse_wind_speed_kmh(first.get("windSpeed"))
        wind_direction_text = first.get("windDirection")

        return {
            "provider": "weather.gov",
            "current": {
                "temperature_c": None,
                "feels_like_c": None,
                "humidity_pct": None,
                "precipitation_mm": None,
                "cloud_cover_pct": None,
                "wind_speed_kmh": wind_speed_kmh,
                "wind_direction_deg": None,
                "wind_gusts_kmh": None,
                "surface_pressure_hpa": None,
                "uv_index": None,
                "shortwave_radiation_wm2": None,
                "wind_direction_text": wind_direction_text,
            },
            "hourly": {"time": [], "temperature_c": [], "wind_speed_kmh": []},
            "daily": {
                "dates": [],
                "temp_max_c": [],
                "temp_min_c": [],
                "precipitation_mm": [],
                "wind_max_kmh": [],
                "uv_max": [],
                "sunrise": [],
                "sunset": [],
            },
        }


class CompositeWeatherProvider:
    def __init__(self) -> None:
        self._open_meteo = OpenMeteoProvider()
        self._nws = NwsProvider()
        self._cache = TimedCache(ttl_seconds=CACHE_TTL_SECONDS)

    def _cache_key(self, lat: float, lon: float) -> str:
        bucket = int(time.time() // 300)
        return f"weather:{_round_coord(lat)}:{_round_coord(lon)}:{bucket}"

    @staticmethod
    def _merge_uncertainty(primary: dict[str, Any], secondary: Optional[dict[str, Any]]) -> dict[str, Any]:
        if not secondary:
            return {
                "wind_speed_spread_kmh": None,
                "temperature_spread_c": None,
            }
        p_wind = primary.get("current", {}).get("wind_speed_kmh")
        s_wind = secondary.get("current", {}).get("wind_speed_kmh")
        wind_spread = None
        if isinstance(p_wind, (int, float)) and isinstance(s_wind, (int, float)):
            wind_spread = round(abs(float(p_wind) - float(s_wind)), 2)

        p_temp = primary.get("current", {}).get("temperature_c")
        s_temp = secondary.get("current", {}).get("temperature_c")
        temp_spread = None
        if isinstance(p_temp, (int, float)) and isinstance(s_temp, (int, float)):
            temp_spread = round(abs(float(p_temp) - float(s_temp)), 2)

        return {
            "wind_speed_spread_kmh": wind_spread,
            "temperature_spread_c": temp_spread,
        }

    async def get_weather(self, lat: float, lon: float) -> dict[str, Any]:
        key = self._cache_key(lat, lon)
        cached = self._cache.get(key)
        if cached is not None:
            cached_copy = dict(cached)
            meta = dict(cached_copy.get("provider_meta", {}))
            meta["cache_hit"] = True
            cached_copy["provider_meta"] = meta
            return cached_copy

        primary = await self._open_meteo.fetch(lat, lon)
        secondary = await self._nws.fetch(lat, lon)

        if primary is None and secondary is None:
            fallback_current = {
                "temperature_c": None,
                "feels_like_c": None,
                "humidity_pct": None,
                "precipitation_mm": 0.0,
                "cloud_cover_pct": None,
                "wind_speed_kmh": 15.0,
                "wind_direction_deg": 270.0,
                "wind_gusts_kmh": 25.0,
                "surface_pressure_hpa": None,
                "uv_index": None,
                "shortwave_radiation_wm2": None,
            }
            result = {
                "current": fallback_current,
                "hourly": {"time": [], "temperature_c": [], "wind_speed_kmh": [], "precipitation_mm": [], "cloud_cover_pct": [], "shortwave_radiation_wm2": []},
                "daily": {"dates": [], "temp_max_c": [], "temp_min_c": [], "precipitation_mm": [], "wind_max_kmh": [], "uv_max": [], "sunrise": [], "sunset": []},
                "provider_meta": {
                    "provider_mix": ["fallback"],
                    "cache_hit": False,
                    "data_freshness": "simulated",
                    "confidence_score": 0.3,
                    "coverage": "global",
                },
                "uncertainty": {"wind_speed_spread_kmh": None, "temperature_spread_c": None},
            }
            self._cache.set(key, result)
            return result

        chosen = primary if primary is not None else secondary
        assert chosen is not None
        providers = [chosen.get("provider", "unknown")]
        if secondary and secondary is not chosen:
            providers.append(secondary.get("provider", "unknown"))

        confidence = _confidence_from_completeness(chosen.get("current", {}), len(providers))
        result = {
            "current": chosen.get("current", {}),
            "hourly": chosen.get("hourly", {}),
            "daily": chosen.get("daily", {}),
            "provider_meta": {
                "provider_mix": providers,
                "cache_hit": False,
                "data_freshness": "near-realtime",
                "confidence_score": confidence,
                "coverage": "global",
            },
            "uncertainty": self._merge_uncertainty(chosen, secondary if secondary is not chosen else None),
        }
        self._cache.set(key, result)
        return result


weather_provider = CompositeWeatherProvider()

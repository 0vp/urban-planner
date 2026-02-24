"""Weather data fetching from Open-Meteo."""

from __future__ import annotations

from typing import Any
from planner_api.simulations.data_providers import weather_provider


async def fetch_weather(lat: float, lon: float) -> dict[str, Any]:
    report = await weather_provider.get_weather(lat, lon)
    current = report.get("current", {})
    daily = report.get("daily", {})
    provider_meta = report.get("provider_meta", {})

    return {
        "current": {
            "temperature_c": current.get("temperature_c"),
            "feels_like_c": current.get("feels_like_c"),
            "humidity_pct": current.get("humidity_pct"),
            "precipitation_mm": current.get("precipitation_mm"),
            "cloud_cover_pct": current.get("cloud_cover_pct"),
            "wind_speed_kmh": current.get("wind_speed_kmh"),
            "wind_direction_deg": current.get("wind_direction_deg"),
            "uv_index": current.get("uv_index"),
            "surface_pressure_hpa": current.get("surface_pressure_hpa"),
            "shortwave_radiation_wm2": current.get("shortwave_radiation_wm2"),
        },
        "forecast_7day": {
            "dates": daily.get("dates", []),
            "temp_max_c": daily.get("temp_max_c", []),
            "temp_min_c": daily.get("temp_min_c", []),
            "precipitation_mm": daily.get("precipitation_mm", []),
            "wind_max_kmh": daily.get("wind_max_kmh", []),
            "uv_max": daily.get("uv_max", []),
            "sunrise": daily.get("sunrise", []),
            "sunset": daily.get("sunset", []),
        },
        "summary": _weather_summary(current, daily, provider_meta),
        "provider_meta": provider_meta,
        "uncertainty": report.get("uncertainty", {}),
    }


def _weather_summary(current: dict, daily: dict, provider_meta: dict[str, Any]) -> dict[str, Any]:
    temp = current.get("temperature_c")
    precip_days = sum(1 for p in daily.get("precipitation_mm", []) if p and p > 0.5)
    avg_high = 0
    temps = daily.get("temp_max_c", [])
    if temps:
        avg_high = round(sum(t for t in temps if t is not None) / max(len(temps), 1), 1)

    conditions = []
    if temp is not None:
        if temp > 30:
            conditions.append("Hot conditions - shade and cooling infrastructure important")
        elif temp < 0:
            conditions.append("Freezing conditions - consider winter walkability and heating")
    if precip_days >= 3:
        conditions.append(f"Rainy week ahead ({precip_days}/7 days) - drainage and covered walkways matter")
    uv = current.get("uv_index")
    if uv and uv >= 6:
        conditions.append(f"High UV index ({uv}) - shade structures recommended in public spaces")

    return {
        "current_temp_c": temp,
        "avg_high_7day_c": avg_high,
        "rainy_days_7day": precip_days,
        "planning_notes": conditions,
        "confidence_score": provider_meta.get("confidence_score", 0.5),
    }

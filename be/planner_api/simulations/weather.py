"""Weather data fetching from Open-Meteo."""

from __future__ import annotations

from typing import Any

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


async def fetch_weather(lat: float, lon: float) -> dict[str, Any]:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,uv_index",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset",
        "forecast_days": 7,
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        return {"error": f"Failed to fetch weather data: {exc}"}

    current = data.get("current", {})
    daily = data.get("daily", {})

    return {
        "current": {
            "temperature_c": current.get("temperature_2m"),
            "feels_like_c": current.get("apparent_temperature"),
            "humidity_pct": current.get("relative_humidity_2m"),
            "precipitation_mm": current.get("precipitation"),
            "cloud_cover_pct": current.get("cloud_cover"),
            "wind_speed_kmh": current.get("wind_speed_10m"),
            "wind_direction_deg": current.get("wind_direction_10m"),
            "uv_index": current.get("uv_index"),
        },
        "forecast_7day": {
            "dates": daily.get("time", []),
            "temp_max_c": daily.get("temperature_2m_max", []),
            "temp_min_c": daily.get("temperature_2m_min", []),
            "precipitation_mm": daily.get("precipitation_sum", []),
            "wind_max_kmh": daily.get("wind_speed_10m_max", []),
            "uv_max": daily.get("uv_index_max", []),
            "sunrise": daily.get("sunrise", []),
            "sunset": daily.get("sunset", []),
        },
        "summary": _weather_summary(current, daily),
    }


def _weather_summary(current: dict, daily: dict) -> dict[str, Any]:
    temp = current.get("temperature_2m")
    precip_days = sum(1 for p in daily.get("precipitation_sum", []) if p and p > 0.5)
    avg_high = 0
    temps = daily.get("temperature_2m_max", [])
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
    }

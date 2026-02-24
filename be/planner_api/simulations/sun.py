"""Sun position calculation for shadow analysis guidance.

The actual shadow rendering happens on the frontend using Three.js.
This module provides sun position data and metrics the agent can use.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any


def _sun_position(lat: float, lon: float, dt: datetime) -> dict[str, float]:
    """Compute solar azimuth and elevation using a simplified algorithm."""
    jd = (dt - datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)).total_seconds() / 86400.0
    mean_lon = (280.460 + 0.9856474 * jd) % 360
    mean_anomaly = math.radians((357.528 + 0.9856003 * jd) % 360)
    ecliptic_lon = math.radians(mean_lon + 1.915 * math.sin(mean_anomaly) + 0.020 * math.sin(2 * mean_anomaly))
    obliquity = math.radians(23.439 - 0.0000004 * jd)

    ra = math.atan2(math.cos(obliquity) * math.sin(ecliptic_lon), math.cos(ecliptic_lon))
    dec = math.asin(math.sin(obliquity) * math.sin(ecliptic_lon))

    gmst = (280.46061837 + 360.98564736629 * jd) % 360
    lha = math.radians(gmst + lon) - ra

    lat_rad = math.radians(lat)
    sin_alt = math.sin(dec) * math.sin(lat_rad) + math.cos(dec) * math.cos(lat_rad) * math.cos(lha)
    altitude = math.degrees(math.asin(max(-1, min(1, sin_alt))))

    cos_az = (math.sin(dec) - math.sin(lat_rad) * sin_alt) / (math.cos(lat_rad) * math.cos(math.radians(altitude)) + 1e-10)
    azimuth = math.degrees(math.acos(max(-1, min(1, cos_az))))
    if math.sin(lha) > 0:
        azimuth = 360 - azimuth

    return {"azimuth": round(azimuth, 2), "elevation": round(altitude, 2)}


def compute_sun_data(
    lat: float,
    lon: float,
    date: str = "2025-06-21",
    hours: list[int] | None = None,
    weather_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if hours is None:
        hours = list(range(6, 21))

    try:
        base_date = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        base_date = datetime(2025, 6, 21, tzinfo=timezone.utc)

    cloud_cover = None
    shortwave_radiation = None
    confidence_score = 0.5
    provider_mix: list[str] = ["astronomical"]
    if isinstance(weather_context, dict):
        cloud_cover = weather_context.get("cloud_cover_pct")
        shortwave_radiation = weather_context.get("shortwave_radiation_wm2")
        meta = weather_context.get("_meta", {})
        if isinstance(meta, dict):
            confidence_score = meta.get("confidence_score", confidence_score)
            provider_mix = ["astronomical", *meta.get("provider_mix", [])]

    cloud_factor = 1.0
    if isinstance(cloud_cover, (int, float)):
        cloud_factor = max(0.25, min(1.0, 1 - float(cloud_cover) / 100 * 0.75))

    positions = []
    daylight_hours = 0
    irradiance_values: list[float] = []
    for h in hours:
        dt = base_date.replace(hour=h)
        pos = _sun_position(lat, lon, dt)
        if pos["elevation"] > 0:
            clear_sky = max(0.0, math.sin(math.radians(pos["elevation"]))) * 1000.0
            irradiance = clear_sky * cloud_factor
            if isinstance(shortwave_radiation, (int, float)):
                irradiance = (irradiance * 0.5) + (float(shortwave_radiation) * 0.5)
            irradiance = round(irradiance, 1)
            irradiance_values.append(irradiance)
        else:
            irradiance = 0.0
        pos["irradiance_wm2"] = irradiance
        pos["hour"] = h
        positions.append(pos)
        if pos["elevation"] > 0:
            daylight_hours += 1

    peak = max(positions, key=lambda p: p["elevation"])

    seasons = {}
    for season, season_date in [("winter", "2025-12-21"), ("spring", "2025-03-21"), ("summer", "2025-06-21"), ("fall", "2025-09-21")]:
        sd = datetime.strptime(season_date, "%Y-%m-%d").replace(tzinfo=timezone.utc, hour=12)
        sp = _sun_position(lat, lon, sd)
        seasons[season] = {"noon_elevation": sp["elevation"], "noon_azimuth": sp["azimuth"]}

    return {
        "date": date,
        "positions": positions,
        "peak": {"hour": peak["hour"], "elevation": peak["elevation"], "azimuth": peak["azimuth"]},
        "calibrated_cloud_factor": round(cloud_factor, 3),
        "daylight_hours": daylight_hours,
        "seasonal_comparison": seasons,
        "summary": {
            "date": date,
            "daylight_hours": daylight_hours,
            "peak_elevation": peak["elevation"],
            "peak_hour": peak["hour"],
            "winter_noon_elevation": seasons["winter"]["noon_elevation"],
            "summer_noon_elevation": seasons["summer"]["noon_elevation"],
            "avg_irradiance_wm2": round(sum(irradiance_values) / max(len(irradiance_values), 1), 1) if irradiance_values else 0.0,
            "confidence_score": confidence_score,
            "provider_mix": provider_mix,
        },
    }

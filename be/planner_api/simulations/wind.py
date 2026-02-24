"""Wind flow simulation with building obstacle effects."""

from __future__ import annotations

import math
from typing import Any, Optional

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


async def fetch_wind_data(lat: float, lon: float) -> dict[str, Any]:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
        "hourly": "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
        "forecast_days": 1,
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            return resp.json()
    except Exception:
        return {"current": {"wind_speed_10m": 15.0, "wind_direction_10m": 270.0, "wind_gusts_10m": 25.0}}


def _wind_direction_to_vector(direction_deg: float) -> tuple[float, float]:
    rad = math.radians(direction_deg)
    return (math.sin(rad), math.cos(rad))


def _building_wind_effect(
    bx: float, by: float, bheight: float,
    px: float, py: float,
    wind_dx: float, wind_dy: float,
    wind_speed: float,
) -> tuple[float, float, float]:
    dx = px - bx
    dy = py - by
    dist = math.sqrt(dx * dx + dy * dy)

    influence_radius = bheight * 3 * 0.00001
    if dist > influence_radius or dist < 1e-8:
        return (0.0, 0.0, 0.0)

    dot = dx * wind_dx + dy * wind_dy
    factor = 1.0 - dist / influence_radius

    if dot < 0:
        speed_delta = -wind_speed * factor * 0.6
        deflect_x = -wind_dy * factor * 0.3
        deflect_y = wind_dx * factor * 0.3
    else:
        speed_delta = -wind_speed * factor * 0.2
        deflect_x = 0
        deflect_y = 0

    return (deflect_x, deflect_y, speed_delta)


async def simulate_wind(
    lat: float,
    lon: float,
    buildings: list[dict[str, Any]],
    grid_size: int = 20,
) -> dict[str, Any]:
    weather = await fetch_wind_data(lat, lon)

    current = weather.get("current", {})
    base_speed = current.get("wind_speed_10m", 15.0)
    base_direction = current.get("wind_direction_10m", 270.0)
    gusts = current.get("wind_gusts_10m", 25.0)

    wind_dx, wind_dy = _wind_direction_to_vector(base_direction)

    radius_deg = 0.012
    grid_points = []

    for gy in range(grid_size):
        for gx in range(grid_size):
            px = lon - radius_deg + (2 * radius_deg * gx / (grid_size - 1))
            py = lat - radius_deg + (2 * radius_deg * gy / (grid_size - 1))

            total_deflect_x = 0.0
            total_deflect_y = 0.0
            total_speed_delta = 0.0

            for b in buildings:
                center = b.get("center", [0, 0])
                if not center or len(center) < 2:
                    continue
                bx, by = center[0], center[1]
                bheight = b.get("height", 10)

                ddx, ddy, dspeed = _building_wind_effect(bx, by, bheight, px, py, wind_dx, wind_dy, base_speed)
                total_deflect_x += ddx
                total_deflect_y += ddy
                total_speed_delta += dspeed

            final_dx = wind_dx * base_speed + total_deflect_x
            final_dy = wind_dy * base_speed + total_deflect_y
            final_speed = max(0, math.sqrt(final_dx ** 2 + final_dy ** 2) + total_speed_delta * 0.3)

            grid_points.append({
                "lon": round(px, 6),
                "lat": round(py, 6),
                "speed": round(final_speed, 2),
                "dx": round(final_dx, 4),
                "dy": round(final_dy, 4),
            })

    tunnel_zones = []
    avg_speed = sum(p["speed"] for p in grid_points) / max(len(grid_points), 1)
    for p in grid_points:
        if p["speed"] > avg_speed * 1.5:
            tunnel_zones.append({"lon": p["lon"], "lat": p["lat"], "speed": p["speed"]})

    calm_zones = [p for p in grid_points if p["speed"] < avg_speed * 0.4]

    return {
        "grid": grid_points,
        "grid_size": grid_size,
        "base_wind": {
            "speed_kmh": round(base_speed, 1),
            "direction_deg": round(base_direction, 1),
            "gusts_kmh": round(gusts, 1),
        },
        "tunnel_zones": tunnel_zones[:20],
        "calm_zones": calm_zones[:20],
        "summary": {
            "avg_speed_kmh": round(avg_speed, 1),
            "max_speed_kmh": round(max(p["speed"] for p in grid_points), 1) if grid_points else 0,
            "min_speed_kmh": round(min(p["speed"] for p in grid_points), 1) if grid_points else 0,
            "wind_tunnels_detected": len(tunnel_zones),
            "calm_zones_detected": len(calm_zones),
        },
    }

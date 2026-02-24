"""Wind flow simulation with building obstacle effects."""

from __future__ import annotations

import math
from typing import Any, Optional
from planner_api.simulations.data_providers import weather_provider


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
    weather_context: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    if weather_context is None:
        report = await weather_provider.get_weather(lat, lon)
        current = report.get("current", {})
        provider_meta = report.get("provider_meta", {})
    else:
        current = weather_context
        provider_meta = weather_context.get("_meta", {}) if isinstance(weather_context, dict) else {}

    base_speed = current.get("wind_speed_kmh", 15.0)
    if not isinstance(base_speed, (int, float)):
        base_speed = 15.0
    base_direction = current.get("wind_direction_deg", 270.0)
    if not isinstance(base_direction, (int, float)):
        base_direction = 270.0
    gusts = current.get("wind_gusts_kmh", max(base_speed * 1.3, 20.0))
    if not isinstance(gusts, (int, float)):
        gusts = max(base_speed * 1.3, 20.0)
    cloud_cover = current.get("cloud_cover_pct")

    wind_dx, wind_dy = _wind_direction_to_vector(base_direction)

    radius_deg = 0.012
    if isinstance(cloud_cover, (int, float)):
        radius_deg *= max(0.8, min(1.2, 1 - (float(cloud_cover) - 50.0) * 0.002))

    roughness = min(1.0, len(buildings) / 600.0)
    terrain_drag = 1.0 - roughness * 0.25
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

            final_dx = wind_dx * base_speed * terrain_drag + total_deflect_x
            final_dy = wind_dy * base_speed * terrain_drag + total_deflect_y
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
            "terrain_drag": round(terrain_drag, 3),
            "confidence_score": provider_meta.get("confidence_score", 0.5),
            "provider_mix": provider_meta.get("provider_mix", ["open-meteo"]),
        },
    }

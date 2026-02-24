"""Wind flow simulation with building obstacle effects."""

from __future__ import annotations

import math
from typing import Any, Optional
from planner_api.simulations.data_providers import weather_provider


def _wind_direction_to_vector(direction_deg: float) -> tuple[float, float]:
    rad = math.radians(direction_deg)
    return (math.sin(rad), math.cos(rad))


def _meters_per_degree(lat: float) -> tuple[float, float]:
    lat_scale = 111320.0
    lon_scale = 111320.0 * max(0.1, math.cos(math.radians(lat)))
    return lon_scale, lat_scale


def _safe_float(value: Any, default: float) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return default


def _estimate_footprint_radius_m(
    building: dict[str, Any],
    center_lon: float,
    center_lat: float,
    meters_per_deg_lon: float,
    meters_per_deg_lat: float,
    height_m: float,
) -> float:
    geom = building.get("geometry") if isinstance(building, dict) else None
    rings = geom.get("rings") if isinstance(geom, dict) else None
    if isinstance(rings, list) and rings:
        first_ring = rings[0] if isinstance(rings[0], list) else None
        if isinstance(first_ring, list) and first_ring:
            max_dist = 0.0
            for point in first_ring:
                if not isinstance(point, list) or len(point) < 2:
                    continue
                px = (_safe_float(point[0], center_lon) - center_lon) * meters_per_deg_lon
                py = (_safe_float(point[1], center_lat) - center_lat) * meters_per_deg_lat
                max_dist = max(max_dist, math.hypot(px, py))
            if max_dist > 1.0:
                return max(6.0, min(60.0, max_dist * 0.9))

    width_attr = _safe_float(building.get("width"), 0.0)
    if width_attr > 0:
        return max(6.0, min(55.0, width_attr * 0.8))

    return max(6.0, min(55.0, 6.0 + height_m * 0.28))


def _build_obstacles(
    buildings: list[dict[str, Any]],
    origin_lon: float,
    origin_lat: float,
    meters_per_deg_lon: float,
    meters_per_deg_lat: float,
) -> list[dict[str, float]]:
    obstacles: list[dict[str, float]] = []
    for idx, building in enumerate(buildings):
        center = building.get("center")
        if not isinstance(center, list) or len(center) < 2:
            continue
        center_lon = _safe_float(center[0], origin_lon)
        center_lat = _safe_float(center[1], origin_lat)

        x = (center_lon - origin_lon) * meters_per_deg_lon
        y = (center_lat - origin_lat) * meters_per_deg_lat
        if not (math.isfinite(x) and math.isfinite(y)):
            continue

        height_m = max(4.0, min(420.0, _safe_float(building.get("height"), 12.0)))
        radius_m = _estimate_footprint_radius_m(
            building,
            center_lon,
            center_lat,
            meters_per_deg_lon,
            meters_per_deg_lat,
            height_m,
        )

        strength = max(0.2, min(1.0, (height_m / 120.0) ** 0.7))
        influence_radius = max(radius_m * (3.5 + 1.2 * strength), 24.0 + height_m * 0.45)
        wake_length = max(influence_radius * (2.2 + 0.4 * strength), height_m * 5.5)
        wake_width = max(radius_m * (2.6 + 0.7 * strength), 14.0 + height_m * 0.35)

        obstacles.append({
            "x": x,
            "y": y,
            "height": height_m,
            "radius": radius_m,
            "strength": strength,
            "influence": influence_radius,
            "wake_length": wake_length,
            "wake_width": wake_width,
            "phase": (idx * 1.137) % (2.0 * math.pi),
        })

    return obstacles


def _building_wind_perturbation(
    point_x: float,
    point_y: float,
    wind_unit_x: float,
    wind_unit_y: float,
    base_speed: float,
    obstacle: dict[str, float],
) -> tuple[float, float]:
    rel_x = point_x - obstacle["x"]
    rel_y = point_y - obstacle["y"]

    downwind = rel_x * wind_unit_x + rel_y * wind_unit_y
    crosswind = -rel_x * wind_unit_y + rel_y * wind_unit_x
    radial_dist = math.hypot(downwind, crosswind)

    influence = obstacle["influence"]
    if radial_dist >= influence:
        return (0.0, 0.0)

    obstacle_radius = obstacle["radius"]
    obstacle_strength = obstacle["strength"]
    side_sign = 1.0 if crosswind >= 0 else -1.0
    side_x = -wind_unit_y * side_sign
    side_y = wind_unit_x * side_sign

    if radial_dist <= obstacle_radius * 0.75:
        block = 1.0 - (radial_dist / max(obstacle_radius * 0.75, 1.0))
        slowdown = base_speed * (0.7 + 0.2 * obstacle_strength) * block
        deflection = base_speed * (0.35 + 0.25 * obstacle_strength) * block
        return (
            -wind_unit_x * slowdown + side_x * deflection,
            -wind_unit_y * slowdown + side_y * deflection,
        )

    influence_factor = 1.0 - (radial_dist / influence)
    wrap = influence_factor ** 1.35
    deflection = base_speed * (0.22 + 0.33 * obstacle_strength) * wrap
    slowdown = base_speed * (0.1 + 0.2 * obstacle_strength) * wrap
    delta_x = side_x * deflection - wind_unit_x * slowdown
    delta_y = side_y * deflection - wind_unit_y * slowdown

    if downwind > 0.0 and downwind < obstacle["wake_length"]:
        wake_width = obstacle["wake_width"] * (1.0 + downwind / max(obstacle["wake_length"], 1.0))
        if abs(crosswind) < wake_width:
            wake_shape = (1.0 - downwind / max(obstacle["wake_length"], 1.0)) * (1.0 - abs(crosswind) / wake_width)
            wake_slowdown = base_speed * (0.35 + 0.25 * obstacle_strength) * wake_shape
            delta_x -= wind_unit_x * wake_slowdown
            delta_y -= wind_unit_y * wake_slowdown

            vortex = math.sin((downwind / max(obstacle_radius, 1.0)) * 1.8 + obstacle["phase"])
            swirl = base_speed * 0.12 * wake_shape * vortex
            delta_x += -wind_unit_y * swirl
            delta_y += wind_unit_x * swirl

    return (delta_x, delta_y)


async def simulate_wind(
    lat: float,
    lon: float,
    buildings: list[dict[str, Any]],
    grid_size: int = 20,
    radius_meters: float = 1200.0,
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
    wind_mag = math.hypot(wind_dx, wind_dy) or 1.0
    wind_unit_x = wind_dx / wind_mag
    wind_unit_y = wind_dy / wind_mag

    grid_size = int(max(18, min(44, grid_size)))
    radius_meters = float(max(300.0, min(5000.0, radius_meters)))

    if isinstance(cloud_cover, (int, float)):
        radius_meters *= max(0.85, min(1.15, 1 - (float(cloud_cover) - 50.0) * 0.0012))

    meters_per_deg_lon, meters_per_deg_lat = _meters_per_degree(lat)
    obstacles = _build_obstacles(buildings, lon, lat, meters_per_deg_lon, meters_per_deg_lat)

    roughness = min(1.0, len(obstacles) / 500.0)
    terrain_drag = 1.0 - roughness * 0.28
    grid_points = []
    in_domain_speeds: list[float] = []

    gust_spread = max(0.0, gusts - base_speed)
    turbulence_gain = min(0.22, 0.05 + roughness * 0.08 + gust_spread / 120.0)

    for gy in range(grid_size):
        for gx in range(grid_size):
            point_x = -radius_meters + (2.0 * radius_meters * gx / (grid_size - 1))
            point_y = -radius_meters + (2.0 * radius_meters * gy / (grid_size - 1))
            in_domain = (point_x * point_x + point_y * point_y) <= radius_meters * radius_meters

            point_lon = lon + (point_x / meters_per_deg_lon)
            point_lat = lat + (point_y / meters_per_deg_lat)

            if not in_domain:
                grid_points.append({
                    "lon": round(point_lon, 6),
                    "lat": round(point_lat, 6),
                    "speed": 0.0,
                    "dx": 0.0,
                    "dy": 0.0,
                    "in_domain": False,
                })
                continue

            gust_phase = (point_x * 0.0022) + (point_y * 0.0014)
            gust_factor = 1.0 + (gust_spread / max(base_speed, 1.0)) * 0.06 * math.sin(gust_phase)
            base_vx = wind_unit_x * base_speed * terrain_drag * gust_factor
            base_vy = wind_unit_y * base_speed * terrain_drag * gust_factor

            delta_x = 0.0
            delta_y = 0.0
            for obstacle in obstacles:
                ddx, ddy = _building_wind_perturbation(
                    point_x,
                    point_y,
                    wind_unit_x,
                    wind_unit_y,
                    base_speed,
                    obstacle,
                )
                delta_x += ddx
                delta_y += ddy

            turbulence_x = math.sin((point_x * 0.0017) - (point_y * 0.0021))
            turbulence_y = math.sin((-point_x * 0.0015) + (point_y * 0.0023) + 1.1)
            delta_x += -wind_unit_y * base_speed * turbulence_gain * turbulence_x
            delta_y += wind_unit_x * base_speed * turbulence_gain * turbulence_y

            final_dx = base_vx + delta_x
            final_dy = base_vy + delta_y
            final_speed = max(0.0, math.hypot(final_dx, final_dy))

            in_domain_speeds.append(final_speed)

            grid_points.append({
                "lon": round(point_lon, 6),
                "lat": round(point_lat, 6),
                "speed": round(final_speed, 2),
                "dx": round(final_dx, 4),
                "dy": round(final_dy, 4),
                "in_domain": True,
            })

    avg_speed = sum(in_domain_speeds) / max(len(in_domain_speeds), 1)
    tunnel_zones = [
        {"lon": p["lon"], "lat": p["lat"], "speed": p["speed"]}
        for p in grid_points
        if p.get("in_domain") and p["speed"] > avg_speed * 1.35
    ]
    tunnel_zones.sort(key=lambda item: item["speed"], reverse=True)

    calm_zones = [
        p for p in grid_points
        if p.get("in_domain") and p["speed"] < avg_speed * 0.45
    ]

    max_speed = max(in_domain_speeds) if in_domain_speeds else 0.0
    min_speed = min(in_domain_speeds) if in_domain_speeds else 0.0
    active_cells = sum(1 for p in grid_points if p.get("in_domain"))

    return {
        "grid": grid_points,
        "grid_size": grid_size,
        "center": [round(lon, 6), round(lat, 6)],
        "radius_meters": round(radius_meters, 1),
        "base_wind": {
            "speed_kmh": round(base_speed, 1),
            "direction_deg": round(base_direction, 1),
            "gusts_kmh": round(gusts, 1),
        },
        "tunnel_zones": tunnel_zones[:20],
        "calm_zones": calm_zones[:20],
        "summary": {
            "avg_speed_kmh": round(avg_speed, 1),
            "max_speed_kmh": round(max_speed, 1),
            "min_speed_kmh": round(min_speed, 1),
            "wind_tunnels_detected": len(tunnel_zones),
            "calm_zones_detected": len(calm_zones),
            "terrain_drag": round(terrain_drag, 3),
            "obstacle_count": len(obstacles),
            "active_grid_cells": active_cells,
            "confidence_score": provider_meta.get("confidence_score", 0.5),
            "provider_mix": provider_meta.get("provider_mix", ["open-meteo"]),
        },
    }

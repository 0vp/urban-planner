import asyncio
import math

from planner_api.simulations.wind import simulate_wind


def _meters_from_lon_lat(lon: float, lat: float, origin_lon: float, origin_lat: float) -> tuple[float, float]:
    meters_per_deg_lat = 111320.0
    meters_per_deg_lon = 111320.0 * math.cos(math.radians(origin_lat))
    return (
        (lon - origin_lon) * meters_per_deg_lon,
        (lat - origin_lat) * meters_per_deg_lat,
    )


def _select_points(
    grid: list[dict],
    origin_lon: float,
    origin_lat: float,
    *,
    x_min: float,
    x_max: float,
    y_min: float,
    y_max: float,
) -> list[dict]:
    selected: list[dict] = []
    for point in grid:
        if not point.get("in_domain"):
            continue
        x, y = _meters_from_lon_lat(point["lon"], point["lat"], origin_lon, origin_lat)
        if x_min <= x <= x_max and y_min <= y <= y_max:
            selected.append(point)
    return selected


def test_wind_wraps_around_building_and_forms_wake() -> None:
    lat = 45.5
    lon = -73.57
    weather_context = {
        "wind_speed_kmh": 28.0,
        "wind_direction_deg": 90.0,
        "wind_gusts_kmh": 40.0,
        "_meta": {"confidence_score": 0.81},
    }

    buildings = [
        {
            "id": "b1",
            "center": [lon, lat],
            "height": 90,
            "geometry": {
                "rings": [[
                    [lon - 0.00007, lat - 0.00006],
                    [lon + 0.00007, lat - 0.00006],
                    [lon + 0.00007, lat + 0.00006],
                    [lon - 0.00007, lat + 0.00006],
                    [lon - 0.00007, lat - 0.00006],
                ]],
            },
        }
    ]

    result = asyncio.run(
        simulate_wind(
            lat,
            lon,
            buildings,
            grid_size=30,
            radius_meters=800,
            weather_context=weather_context,
        )
    )

    grid = result["grid"]
    north_band = _select_points(grid, lon, lat, x_min=-80, x_max=80, y_min=40, y_max=170)
    south_band = _select_points(grid, lon, lat, x_min=-80, x_max=80, y_min=-170, y_max=-40)
    upwind_band = _select_points(grid, lon, lat, x_min=-220, x_max=-80, y_min=-60, y_max=60)
    core_band = _select_points(grid, lon, lat, x_min=-60, x_max=60, y_min=-60, y_max=60)

    assert north_band and south_band and upwind_band and core_band

    north_avg_dy = sum(p["dy"] for p in north_band) / len(north_band)
    south_avg_dy = sum(p["dy"] for p in south_band) / len(south_band)
    upwind_avg_speed = sum(p["speed"] for p in upwind_band) / len(upwind_band)
    core_avg_speed = sum(p["speed"] for p in core_band) / len(core_band)

    assert north_avg_dy > south_avg_dy + 0.2
    assert core_avg_speed < upwind_avg_speed - 1.0
    assert result["summary"]["obstacle_count"] == 1


def test_wind_respects_radius_and_marks_domain() -> None:
    lat = 45.5
    lon = -73.57
    weather_context = {
        "wind_speed_kmh": 18.0,
        "wind_direction_deg": 270.0,
        "wind_gusts_kmh": 24.0,
    }

    result = asyncio.run(
        simulate_wind(
            lat,
            lon,
            [],
            grid_size=26,
            radius_meters=1600,
            weather_context=weather_context,
        )
    )

    assert result["grid_size"] == 26
    assert result["radius_meters"] == 1600.0
    assert len(result["grid"]) == 26 * 26

    in_domain = [p for p in result["grid"] if p.get("in_domain")]
    out_domain = [p for p in result["grid"] if not p.get("in_domain")]
    assert len(in_domain) > 0
    assert len(out_domain) > 0
    assert result["summary"]["active_grid_cells"] == len(in_domain)

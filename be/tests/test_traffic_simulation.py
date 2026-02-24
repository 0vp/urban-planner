from planner_api.simulations import traffic as traffic_sim


def _make_grid_roads(size: int) -> list[dict]:
    roads: list[dict] = []
    base_lon = -73.57
    base_lat = 45.50
    step = 0.0002

    for y in range(size):
        path = [[base_lon + x * step, base_lat + y * step, 0] for x in range(size)]
        roads.append({"id": f"h{y}", "name": f"H{y}", "type": "residential", "paths": [path]})

    for x in range(size):
        path = [[base_lon + x * step, base_lat + y * step, 0] for y in range(size)]
        roads.append({"id": f"v{x}", "name": f"V{x}", "type": "residential", "paths": [path]})

    return roads


def test_traffic_uses_exact_on_small_graph() -> None:
    roads = [
        {
            "id": "r1",
            "name": "Main",
            "type": "primary",
            "paths": [[[-73.57, 45.50, 0], [-73.569, 45.501, 0], [-73.568, 45.502, 0]]],
        },
        {
            "id": "r2",
            "name": "Second",
            "type": "secondary",
            "paths": [[[-73.569, 45.501, 0], [-73.569, 45.503, 0]]],
        },
    ]

    result = traffic_sim.simulate_traffic(roads, time_of_day="midday")

    assert result["summary"]["algorithm"] == "exact"
    assert result["summary"]["graph_edges"] > 0
    assert len(result["segments"]) > 0


def test_traffic_uses_approximation_and_cache_on_large_graph() -> None:
    roads = _make_grid_roads(30)
    traffic_sim._betweenness_cache.clear()

    first = traffic_sim.simulate_traffic(roads, time_of_day="evening_rush")
    second = traffic_sim.simulate_traffic(roads, time_of_day="morning_rush")

    assert first["summary"]["algorithm"].startswith("approx_k")
    assert first["summary"]["cache_hit"] is False
    assert first["summary"]["graph_edges"] > traffic_sim.EXACT_BETWEENNESS_MAX_EDGES
    assert second["summary"]["algorithm"] == "cache"
    assert second["summary"]["cache_hit"] is True

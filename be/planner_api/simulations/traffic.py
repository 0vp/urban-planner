"""Traffic flow simulation using road network graph analysis."""

from __future__ import annotations

import math
from collections import OrderedDict
from threading import Lock
from time import perf_counter
from typing import Any, Optional

import networkx as nx


ROAD_CAPACITY = {
    "motorway": 2000,
    "trunk": 1800,
    "primary": 1200,
    "secondary": 800,
    "tertiary": 600,
    "residential": 300,
    "service": 150,
    "unclassified": 200,
    "living_street": 100,
}

DEFAULT_SPEED_KMH = {
    "motorway": 100,
    "trunk": 80,
    "primary": 60,
    "secondary": 50,
    "tertiary": 40,
    "residential": 30,
    "service": 20,
    "unclassified": 30,
    "living_street": 15,
}

TIME_OF_DAY_MULTIPLIER = {
    "morning_rush": 1.4,
    "midday": 0.7,
    "evening_rush": 1.5,
    "night": 0.3,
    "default": 1.0,
}

EXACT_BETWEENNESS_MAX_EDGES = 1400
APPROX_MIN_K = 32
APPROX_MAX_K = 96
CENTRALITY_CACHE_SIZE = 6

_betweenness_cache: OrderedDict[str, dict[tuple[tuple[float, float], tuple[float, float]], float]] = OrderedDict()
_betweenness_cache_lock = Lock()


def _haversine_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _graph_signature_from_roads(roads: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for road in roads:
        road_id = str(road.get("id", ""))
        road_type = str(road.get("type", ""))
        lanes = str(road.get("lanes", ""))
        maxspeed = str(road.get("maxspeed", road.get("maxspeed_kmh", "")))
        oneway = str(road.get("oneway", ""))
        paths = road.get("paths", [])
        parts.append(f"{road_id}:{road_type}:{lanes}:{maxspeed}:{oneway}:{len(paths)}")
        for path in paths:
            if len(path) < 2:
                continue
            first = path[0]
            last = path[-1]
            parts.append(
                f"{len(path)}@{round(first[0], 5)},{round(first[1], 5)}>{round(last[0], 5)},{round(last[1], 5)}"
            )
    return "|".join(parts)


def _parse_speed_kmh(value: Any, road_type: str) -> float:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return max(10.0, min(130.0, float(value)))
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit() or ch in {".", "-"})
        if digits:
            try:
                return max(10.0, min(130.0, float(digits)))
            except ValueError:
                pass
    return float(DEFAULT_SPEED_KMH.get(road_type, 30))


def _parse_lanes(value: Any) -> float:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return max(1.0, min(8.0, float(value)))
    if isinstance(value, str):
        digits = "".join(ch for ch in value if ch.isdigit() or ch in {".", "-"})
        if digits:
            try:
                return max(1.0, min(8.0, float(digits)))
            except ValueError:
                return 1.0
    return 1.0


def _normalize_oneway(value: Any) -> str:
    if value is None:
        return "no"
    text = str(value).strip().lower()
    if text in {"yes", "true", "1"}:
        return "yes"
    if text in {"-1", "reverse"}:
        return "-1"
    return "no"


def _capacity_for_road(road_type: str, lanes: float, maxspeed_kmh: float) -> float:
    base = float(ROAD_CAPACITY.get(road_type, 200))
    lane_factor = 0.65 + 0.35 * lanes
    speed_factor = max(0.7, min(1.35, maxspeed_kmh / 50.0))
    return max(80.0, base * lane_factor * speed_factor)


def _build_road_graph(roads: list[dict[str, Any]]) -> nx.DiGraph:
    g = nx.DiGraph()
    for road in roads:
        paths = road.get("paths", [])
        road_type = road.get("type", "residential")
        lanes = _parse_lanes(road.get("lanes"))
        maxspeed_kmh = _parse_speed_kmh(road.get("maxspeed", road.get("maxspeed_kmh")), road_type)
        oneway = _normalize_oneway(road.get("oneway"))
        capacity = _capacity_for_road(road_type, lanes, maxspeed_kmh)
        road_name = road.get("name", "Road")
        road_id = road.get("id", "")

        for path in paths:
            if len(path) < 2:
                continue
            for i in range(len(path) - 1):
                p1, p2 = path[i], path[i + 1]
                n1 = (round(p1[0], 6), round(p1[1], 6))
                n2 = (round(p2[0], 6), round(p2[1], 6))
                dist = _haversine_meters(p1[0], p1[1], p2[0], p2[1])
                if dist < 0.5:
                    continue

                edge_payload = {
                    "distance": dist,
                    "capacity": capacity,
                    "road_type": road_type,
                    "road_name": road_name,
                    "road_id": road_id,
                    "lanes": lanes,
                    "maxspeed_kmh": maxspeed_kmh,
                    "oneway": oneway,
                }

                if oneway == "-1":
                    g.add_edge(n2, n1, **edge_payload)
                elif oneway == "yes":
                    g.add_edge(n1, n2, **edge_payload)
                else:
                    g.add_edge(n1, n2, **edge_payload)
                    g.add_edge(n2, n1, **edge_payload)
    return g


def _weather_capacity_factor(weather_context: Optional[dict[str, Any]]) -> float:
    if not isinstance(weather_context, dict):
        return 1.0
    precip = weather_context.get("precipitation_mm")
    wind_speed = weather_context.get("wind_speed_kmh")
    precip_penalty = 0.0
    wind_penalty = 0.0
    if isinstance(precip, (int, float)):
        precip_penalty = min(0.25, max(0.0, float(precip) * 0.03))
    if isinstance(wind_speed, (int, float)):
        wind_penalty = min(0.2, max(0.0, (float(wind_speed) - 35.0) * 0.006))
    return max(0.55, min(1.0, 1.0 - precip_penalty - wind_penalty))


def _choose_approximation_k(node_count: int) -> int:
    return max(APPROX_MIN_K, min(APPROX_MAX_K, int(math.sqrt(max(node_count, 1)))))


def _compute_edge_betweenness(
    g: nx.Graph,
    graph_signature: str,
) -> tuple[dict[tuple[tuple[float, float], tuple[float, float]], float], str, bool, float]:
    with _betweenness_cache_lock:
        cached = _betweenness_cache.get(graph_signature)
        if cached is not None:
            _betweenness_cache.move_to_end(graph_signature)
            return cached, "cache", True, 0.0

    edge_count = g.number_of_edges()
    node_count = g.number_of_nodes()

    start = perf_counter()
    method = "exact"
    try:
        if edge_count <= EXACT_BETWEENNESS_MAX_EDGES:
            betweenness = nx.edge_betweenness_centrality(g, weight="distance", normalized=True)
        else:
            k = _choose_approximation_k(node_count)
            method = f"approx_k{k}"
            betweenness = nx.edge_betweenness_centrality(
                g,
                k=k,
                weight="distance",
                normalized=True,
                seed=42,
            )
    except Exception:
        method = "fallback_uniform"
        betweenness = {e: 0.5 for e in g.edges()}

    runtime_ms = (perf_counter() - start) * 1000

    with _betweenness_cache_lock:
        _betweenness_cache[graph_signature] = betweenness
        _betweenness_cache.move_to_end(graph_signature)
        while len(_betweenness_cache) > CENTRALITY_CACHE_SIZE:
            _betweenness_cache.popitem(last=False)

    return betweenness, method, False, runtime_ms


def simulate_traffic(
    roads: list[dict[str, Any]],
    time_of_day: str = "default",
    polygon: Optional[list[list[float]]] = None,
    weather_context: Optional[dict[str, Any]] = None,
    demand_multiplier: float = 1.0,
) -> dict[str, Any]:
    graph_signature = _graph_signature_from_roads(roads)
    g = _build_road_graph(roads)

    if g.number_of_edges() == 0:
        return {
            "segments": [],
            "hotspots": [],
            "summary": {
                "total_roads": 0,
                "congested_segments": 0,
                "algorithm": "none",
            },
        }

    multiplier = TIME_OF_DAY_MULTIPLIER.get(time_of_day, 1.0)
    demand_multiplier = max(0.5, min(2.0, float(demand_multiplier)))
    weather_factor = _weather_capacity_factor(weather_context)
    betweenness, algorithm, cache_hit, centrality_runtime_ms = _compute_edge_betweenness(g, graph_signature)

    max_bc = max(betweenness.values()) if betweenness else 1.0
    if max_bc == 0:
        max_bc = 1.0

    segments = []
    for (u, v), bc in betweenness.items():
        edge_data = g[u][v]
        capacity = edge_data.get("capacity", 200)
        effective_capacity = max(50.0, capacity * weather_factor)
        normalized_bc = bc / max_bc
        estimated_volume = capacity * normalized_bc * multiplier * demand_multiplier
        vc_ratio = min(2.0, estimated_volume / max(effective_capacity, 1))

        if vc_ratio < 0.5:
            congestion = "free_flow"
        elif vc_ratio < 0.8:
            congestion = "moderate"
        elif vc_ratio < 1.0:
            congestion = "heavy"
        else:
            congestion = "gridlock"

        segments.append({
            "from": list(u),
            "to": list(v),
            "road_name": edge_data.get("road_name", "Road"),
            "road_type": edge_data.get("road_type", "road"),
            "road_id": edge_data.get("road_id", ""),
            "capacity": round(capacity),
            "effective_capacity": round(effective_capacity),
            "lanes": round(float(edge_data.get("lanes", 1.0)), 2),
            "maxspeed_kmh": round(float(edge_data.get("maxspeed_kmh", 30.0)), 1),
            "oneway": edge_data.get("oneway", "no"),
            "estimated_volume": round(estimated_volume),
            "vc_ratio": round(vc_ratio, 3),
            "congestion": congestion,
            "distance_m": round(edge_data.get("distance", 0), 1),
        })

    segments.sort(key=lambda s: s["vc_ratio"], reverse=True)

    hotspots = []
    seen_roads = set()
    for seg in segments:
        if seg["vc_ratio"] >= 0.8 and seg["road_name"] not in seen_roads:
            hotspots.append({
                "road_name": seg["road_name"],
                "road_type": seg["road_type"],
                "congestion": seg["congestion"],
                "vc_ratio": seg["vc_ratio"],
                "location": seg["from"],
            })
            seen_roads.add(seg["road_name"])
            if len(hotspots) >= 15:
                break

    congested = sum(1 for s in segments if s["vc_ratio"] >= 0.8)

    return {
        "segments": segments[:500],
        "hotspots": hotspots,
        "summary": {
            "total_segments": len(segments),
            "congested_segments": congested,
            "congestion_ratio": round(congested / max(len(segments), 1), 3),
            "time_of_day": time_of_day,
            "avg_vc_ratio": round(sum(s["vc_ratio"] for s in segments) / max(len(segments), 1), 3),
            "algorithm": algorithm,
            "cache_hit": cache_hit,
            "centrality_runtime_ms": round(centrality_runtime_ms, 1),
            "graph_nodes": g.number_of_nodes(),
            "graph_edges": g.number_of_edges(),
            "weather_factor": round(weather_factor, 3),
            "demand_multiplier": round(demand_multiplier, 3),
            "confidence_score": weather_context.get("_meta", {}).get("confidence_score", 0.6) if isinstance(weather_context, dict) else 0.6,
        },
    }

"""Traffic flow simulation using road network graph analysis."""

from __future__ import annotations

import math
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

TIME_OF_DAY_MULTIPLIER = {
    "morning_rush": 1.4,
    "midday": 0.7,
    "evening_rush": 1.5,
    "night": 0.3,
    "default": 1.0,
}


def _haversine_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _build_road_graph(roads: list[dict[str, Any]]) -> nx.Graph:
    g = nx.Graph()
    for road in roads:
        paths = road.get("paths", [])
        road_type = road.get("type", "residential")
        capacity = ROAD_CAPACITY.get(road_type, 200)
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
                g.add_edge(n1, n2, distance=dist, capacity=capacity, road_type=road_type, road_name=road_name, road_id=road_id)
    return g


def simulate_traffic(
    roads: list[dict[str, Any]],
    time_of_day: str = "default",
    polygon: Optional[list[list[float]]] = None,
) -> dict[str, Any]:
    g = _build_road_graph(roads)

    if g.number_of_edges() == 0:
        return {"segments": [], "hotspots": [], "summary": {"total_roads": 0, "congested_segments": 0}}

    multiplier = TIME_OF_DAY_MULTIPLIER.get(time_of_day, 1.0)

    try:
        betweenness = nx.edge_betweenness_centrality(g, weight="distance", normalized=True)
    except Exception:
        betweenness = {e: 0.5 for e in g.edges()}

    max_bc = max(betweenness.values()) if betweenness else 1.0
    if max_bc == 0:
        max_bc = 1.0

    segments = []
    for (u, v), bc in betweenness.items():
        edge_data = g[u][v]
        capacity = edge_data.get("capacity", 200)
        normalized_bc = bc / max_bc
        estimated_volume = capacity * normalized_bc * multiplier
        vc_ratio = min(2.0, estimated_volume / max(capacity, 1))

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
            "capacity": capacity,
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
        },
    }

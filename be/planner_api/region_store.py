"""In-memory store for the currently loaded region's features."""

from __future__ import annotations

import math
from typing import Any, Optional


class RegionStore:
    def __init__(self) -> None:
        self._center: list[float] = [0.0, 0.0]
        self._radius_meters: float = 1200.0
        self._location: str = ""
        self._features: list[dict[str, Any]] = []

    def update(self, location: str, center: list[float], radius_meters: float, features: list[dict[str, Any]]) -> None:
        self._location = location
        self._center = list(center) if center else [0.0, 0.0]
        self._radius_meters = radius_meters
        self._features = list(features) if features else []

    @property
    def location(self) -> str:
        return self._location

    @property
    def center(self) -> list[float]:
        return self._center

    def get_summary(self) -> dict[str, Any]:
        buildings = [f for f in self._features if f.get("entityType") == "building"]
        roads = [f for f in self._features if f.get("entityType") == "road"]
        parks = [f for f in self._features if f.get("entityType") == "park"]
        rivers = [f for f in self._features if f.get("entityType") == "river"]

        named_buildings = [
            {"name": f["attributes"]["name"], "type": f["attributes"].get("type", ""), "center": f.get("center")}
            for f in buildings
            if f.get("attributes", {}).get("name") and f["attributes"]["name"] != "Building"
        ][:30]

        road_names: list[str] = []
        named_roads: list[dict[str, str]] = []
        for f in roads:
            name = f.get("attributes", {}).get("name", "")
            if name and name != "Road" and name not in road_names:
                road_names.append(name)
                named_roads.append({"name": name, "type": f["attributes"].get("type", "")})
            if len(named_roads) >= 30:
                break

        return {
            "location": self._location,
            "center": self._center,
            "radius_meters": self._radius_meters,
            "counts": {
                "buildings": len(buildings),
                "roads": len(roads),
                "parks": len(parks),
                "rivers": len(rivers),
                "total": len(self._features),
            },
            "notable_buildings": named_buildings,
            "notable_roads": named_roads,
        }

    def query_buildings(self, name: Optional[str] = None, building_type: Optional[str] = None) -> list[dict[str, Any]]:
        results = []
        for f in self._features:
            if f.get("entityType") != "building":
                continue
            attrs = f.get("attributes", {})
            if name and name.lower() not in (attrs.get("name") or "").lower():
                continue
            if building_type and building_type.lower() not in (attrs.get("type") or "").lower():
                continue
            results.append({
                "id": f.get("id"),
                "name": attrs.get("name", "Building"),
                "type": attrs.get("type", ""),
                "height": attrs.get("height"),
                "floors": attrs.get("floors"),
                "center": f.get("center"),
            })
        return results[:100]

    def query_roads(self, name: Optional[str] = None, road_type: Optional[str] = None) -> list[dict[str, Any]]:
        results = []
        for f in self._features:
            if f.get("entityType") != "road":
                continue
            attrs = f.get("attributes", {})
            if name and name.lower() not in (attrs.get("name") or "").lower():
                continue
            if road_type and road_type.lower() not in (attrs.get("type") or "").lower():
                continue
            results.append({
                "id": f.get("id"),
                "name": attrs.get("name", "Road"),
                "type": attrs.get("type", ""),
                "width": attrs.get("width"),
            })
        return results[:100]

    def query_features_in_area(self, polygon: list[list[float]]) -> list[dict[str, Any]]:
        if not polygon or len(polygon) < 3:
            return self._features[:200]

        results = []
        for f in self._features:
            point = self._feature_point(f)
            if not point:
                continue

            attrs = f.get("attributes", {})

            if _point_in_polygon(point, polygon):
                results.append({
                    "id": f.get("id"),
                    "entityType": f.get("entityType"),
                    "name": f.get("attributes", {}).get("name", ""),
                    "type": f.get("attributes", {}).get("type", ""),
                    "center": point,
                })
        return results[:200]

    def get_all_features(self) -> list[dict[str, Any]]:
        return self._features

    def _feature_point(self, feature: dict[str, Any]) -> Optional[list[float]]:
        point = feature.get("center")
        if isinstance(point, list) and len(point) >= 2:
            return [point[0], point[1]]

        geom = feature.get("geometry", {})
        paths = geom.get("paths") or geom.get("rings")
        if not paths or not isinstance(paths, list) or len(paths) == 0 or not isinstance(paths[0], list) or len(paths[0]) == 0:
            return None

        ring = paths[0]
        valid_points = [p for p in ring if isinstance(p, list) and len(p) >= 2]
        if not valid_points:
            return None

        px = sum(p[0] for p in valid_points) / len(valid_points)
        py = sum(p[1] for p in valid_points) / len(valid_points)
        return [px, py]

    def get_roads_for_graph(self) -> list[dict[str, Any]]:
        roads = []
        for f in self._features:
            if f.get("entityType") != "road":
                continue
            geom = f.get("geometry", {})
            paths = geom.get("paths", [])
            attrs = f.get("attributes", {})
            roads.append({
                "id": f.get("id"),
                "name": attrs.get("name", "Road"),
                "type": attrs.get("type", "road"),
                "width": attrs.get("width", 6),
                "lanes": attrs.get("lanes", 1),
                "maxspeed": attrs.get("maxspeed", attrs.get("maxspeed_kmh")),
                "oneway": attrs.get("oneway", "no"),
                "paths": paths,
            })
        return roads

    def get_buildings_for_simulation(self) -> list[dict[str, Any]]:
        buildings = []
        for f in self._features:
            if f.get("entityType") != "building":
                continue
            attrs = f.get("attributes", {})
            geometry = f.get("geometry") if isinstance(f.get("geometry"), dict) else {}
            buildings.append({
                "id": f.get("id"),
                "name": attrs.get("name", "Building"),
                "center": f.get("center", [0, 0]),
                "height": attrs.get("height", 10),
                "floors": attrs.get("floors", 3),
                "width": attrs.get("width"),
                "geometry": {
                    "rings": geometry.get("rings") if isinstance(geometry.get("rings"), list) else None,
                },
            })
        return buildings

    def analyze_density(
        self,
        polygon: Optional[list[list[float]]] = None,
        features: Optional[list[dict[str, Any]]] = None,
        radius_meters: Optional[float] = None,
    ) -> dict[str, Any]:
        source_features = features if isinstance(features, list) else self._features

        feats = []
        for f in source_features:
            point = self._feature_point(f)
            if polygon and (not point or not _point_in_polygon(point, polygon)):
                continue
            feats.append({
                "id": f.get("id"),
                "entityType": f.get("entityType"),
                "name": f.get("attributes", {}).get("name", ""),
                "type": f.get("attributes", {}).get("type", ""),
                "center": point,
                "geometry": f.get("geometry"),
            })

        effective_radius_meters = radius_meters if isinstance(radius_meters, (float, int)) else self._radius_meters
        area_km2 = math.pi * (float(effective_radius_meters) / 1000) ** 2
        buildings = [f for f in feats if f.get("entityType") == "building"]
        roads = [f for f in feats if f.get("entityType") == "road"]
        parks = [f for f in feats if f.get("entityType") == "park"]

        total = len(feats) or 1
        green_ratio = len(parks) / total
        building_density = len(buildings) / max(area_km2, 0.01)
        road_density = len(roads) / max(area_km2, 0.01)
        road_connectivity = _road_connectivity_score(roads)

        walkability = min(100, int(
            25 * min(1.0, road_density / 200)
            + 25 * min(1.0, green_ratio * 5)
            + 25 * min(1.0, building_density / 500)
            + 15 * (1 if len(parks) >= 2 else 0.5)
            + 10 * min(1.0, road_connectivity / 0.35)
        ))

        confidence_score = min(0.95, max(0.25, 0.35 + min(0.4, len(feats) / 4000) + min(0.2, road_connectivity)))

        return {
            "area_km2": round(area_km2, 3),
            "buildings": len(buildings),
            "roads": len(roads),
            "parks": len(parks),
            "building_density_per_km2": round(building_density, 1),
            "road_density_per_km2": round(road_density, 1),
            "road_connectivity_score": round(road_connectivity, 3),
            "green_space_ratio": round(green_ratio, 3),
            "walkability_score": walkability,
            "confidence_score": round(confidence_score, 3),
            "provider_mix": ["osm/arcgis-features"],
        }


def _point_in_polygon(point: list[float], polygon: list[list[float]]) -> bool:
    x, y = point[0], point[1]
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _road_connectivity_score(roads: list[dict[str, Any]]) -> float:
    endpoints: dict[tuple[float, float], int] = {}
    for road in roads:
        geom = road.get("geometry") or {}
        paths = geom.get("paths") if isinstance(geom, dict) else None
        if not isinstance(paths, list):
            continue
        for path in paths:
            if not isinstance(path, list) or len(path) < 2:
                continue
            start = path[0]
            end = path[-1]
            if not (isinstance(start, list) and isinstance(end, list) and len(start) >= 2 and len(end) >= 2):
                continue
            try:
                s_key = (round(float(start[0]), 5), round(float(start[1]), 5))
                e_key = (round(float(end[0]), 5), round(float(end[1]), 5))
            except (TypeError, ValueError):
                continue
            endpoints[s_key] = endpoints.get(s_key, 0) + 1
            endpoints[e_key] = endpoints.get(e_key, 0) + 1

    if not endpoints:
        return 0.0

    intersections = sum(1 for degree in endpoints.values() if degree >= 3)
    return intersections / max(len(endpoints), 1)


region_store = RegionStore()

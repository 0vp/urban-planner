from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import json
import re
from urllib import error as url_error
from urllib import request as url_request

from fastapi import APIRouter, HTTPException, Query, Request

try:
    import requests
except ImportError:  # pragma: no cover - runtime fallback
    requests = None

from planner_api.models import PlannerMapPayload, PlannerMapResponse
from planner_api.region_store import region_store
from planner_api.simulations.sun import compute_sun_data
from planner_api.simulations.traffic import simulate_traffic
from planner_api.simulations.weather import fetch_weather
from planner_api.simulations.wind import simulate_wind
from planner_api.storage import PlannerStorage


router = APIRouter(prefix="/api/planner", tags=["planner"])
storage = PlannerStorage(Path(__file__).resolve().parent.parent / "data" / "planner")
OVERPASS_URLS = (
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
OVERPASS_CONNECT_TIMEOUT_SECONDS = 4
OVERPASS_READ_TIMEOUT_SECONDS = 10


async def _read_json_body(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _parse_number(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _road_width_from_tags(tags: dict[str, str]) -> float:
    width = _parse_number(tags.get("width"))
    if width and width > 0:
        return max(2.0, min(30.0, width))
    lanes = _parse_number(tags.get("lanes"))
    if lanes and lanes > 0:
        return max(4.0, min(30.0, lanes * 3.2))
    return 6.0


def _post_overpass(endpoint: str, query: str) -> str | None:
    if requests is not None:
        try:
            response = requests.post(
                endpoint,
                data=query,
                headers={
                    "Content-Type": "text/plain; charset=utf-8",
                    "User-Agent": "urban-planner/1.0",
                },
                timeout=(OVERPASS_CONNECT_TIMEOUT_SECONDS, OVERPASS_READ_TIMEOUT_SECONDS),
            )
            if response.status_code >= 400:
                return None
            raw = response.text
        except requests.RequestException:
            return None
    else:
        req = url_request.Request(
            endpoint,
            data=query.encode("utf-8"),
            headers={
                "Content-Type": "text/plain; charset=utf-8",
                "User-Agent": "urban-planner/1.0",
            },
            method="POST",
        )
        try:
            with url_request.urlopen(req, timeout=OVERPASS_READ_TIMEOUT_SECONDS) as response:
                raw = response.read().decode("utf-8")
        except (url_error.URLError, TimeoutError):
            return None

    if not raw or raw.lstrip().startswith("<"):
        return None

    return raw


def _query_overpass_payload(query: str) -> dict:
    max_workers = max(1, len(OVERPASS_URLS))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_endpoint = {
            executor.submit(_post_overpass, endpoint, query): endpoint
            for endpoint in OVERPASS_URLS
        }

        for future in as_completed(future_to_endpoint):
            try:
                raw = future.result()
            except Exception:  # pragma: no cover - defensive fallback
                continue
            if raw is None:
                continue

            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if isinstance(payload, dict) and isinstance(payload.get("elements"), list):
                for pending in future_to_endpoint:
                    if pending is not future:
                        pending.cancel()
                return payload

    raise HTTPException(status_code=502, detail="Road fallback provider is unavailable")


def _query_overpass_roads(lon: float, lat: float, radius_meters: int) -> list[dict]:
    effective_radius = max(300, min(radius_meters, 10000))
    query = (
        "[out:json][timeout:10];"
        f"way(around:{effective_radius},{lat},{lon})"
        "[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|residential|service|unclassified|living_street)$\"];"
        "out geom qt;"
    )
    payload = _query_overpass_payload(query)
    elements = payload.get("elements") if isinstance(payload, dict) else None
    if not isinstance(elements, list):
        return []

    features: list[dict] = []
    for element in elements:
        if element.get("type") != "way":
            continue
        geometry = element.get("geometry")
        if not isinstance(geometry, list) or len(geometry) < 2:
            continue

        path = []
        for point in geometry:
            x = point.get("lon")
            y = point.get("lat")
            if x is None or y is None:
                continue
            path.append([x, y, 0])
        if len(path) < 2:
            continue

        tags = element.get("tags") if isinstance(element.get("tags"), dict) else {}
        features.append({
            "entityType": "road",
            "id": f"road_osm_{element.get('id')}",
            "geometry": {
                "type": "polyline",
                "paths": [path],
            },
            "attributes": {
                "name": tags.get("name") or "Road",
                "type": tags.get("highway") or "road",
                "width": _road_width_from_tags(tags),
            },
        })

    return features


@router.get("/map", response_model=PlannerMapResponse)
def get_map(location: str = Query(..., min_length=1, max_length=200)) -> PlannerMapResponse:
    try:
        return storage.read(location)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid planner map data") from exc


@router.put("/map", response_model=PlannerMapResponse)
def put_map(payload: PlannerMapPayload) -> PlannerMapResponse:
    try:
        return storage.write(payload)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to save map") from exc


@router.get("/osm/roads")
def get_osm_roads(
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    radius_meters: int = Query(1200, ge=300, le=10000),
) -> dict[str, list[dict]]:
    return {"features": _query_overpass_roads(lon, lat, radius_meters)}


@router.post("/region")
async def update_region(request: Request) -> dict:
    payload = await _read_json_body(request)
    location = payload.get("location", "")
    center = payload.get("center", [0, 0])
    radius_meters = payload.get("radiusMeters", 1200)
    features = payload.get("features", [])
    if not isinstance(center, list) or len(center) < 2:
        center = [0, 0]
    if not isinstance(features, list):
        features = []
    try:
        radius_meters = float(radius_meters)
    except (TypeError, ValueError):
        radius_meters = 1200
    region_store.update(location, center, radius_meters, features)
    return {"ok": True, "feature_count": len(features)}


@router.get("/region/summary")
def get_region_summary() -> dict:
    return region_store.get_summary()


@router.post("/simulate/traffic")
async def post_simulate_traffic(request: Request) -> dict:
    payload = await _read_json_body(request)
    roads = payload.get("roads")
    if not isinstance(roads, list) or not roads:
        roads = region_store.get_roads_for_graph()
    time_of_day = payload.get("time_of_day", "default")
    polygon = payload.get("polygon")
    return simulate_traffic(roads, time_of_day=time_of_day, polygon=polygon)


@router.post("/simulate/wind")
async def post_simulate_wind(request: Request) -> dict:
    payload = await _read_json_body(request)
    lat = payload.get("lat")
    lon = payload.get("lon")
    if isinstance(lat, str):
        lat = _parse_number(lat)
    if isinstance(lon, str):
        lon = _parse_number(lon)
    buildings = payload.get("buildings")
    if lat is None or lon is None:
        center = region_store.center
        lat, lon = center[1], center[0]
    if not isinstance(buildings, list) or not buildings:
        buildings = region_store.get_buildings_for_simulation()
    return await simulate_wind(lat, lon, buildings)


@router.post("/simulate/sun")
async def post_simulate_sun(request: Request) -> dict:
    payload = await _read_json_body(request)
    lat = payload.get("lat")
    lon = payload.get("lon")
    if isinstance(lat, str):
        lat = _parse_number(lat)
    if isinstance(lon, str):
        lon = _parse_number(lon)
    if lat is None or lon is None:
        center = region_store.center
        lat, lon = center[1], center[0]
    date = payload.get("date", "2025-06-21")
    hours = payload.get("hours")
    return compute_sun_data(lat, lon, date=date, hours=hours)


@router.get("/weather")
async def get_weather(
    lon: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
) -> dict:
    return await fetch_weather(lat, lon)


@router.get("/region/density")
def get_density() -> dict:
    return region_store.analyze_density()


@router.post("/region/density")
async def post_density_in_area(request: Request) -> dict:
    payload = await _read_json_body(request)
    polygon = payload.get("polygon")
    features = payload.get("features")
    radius_meters = payload.get("radius_meters")
    return region_store.analyze_density(
        polygon=polygon,
        features=features if isinstance(features, list) else None,
        radius_meters=radius_meters,
    )

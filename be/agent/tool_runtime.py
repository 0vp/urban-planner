"""Tool execution runtime and in-memory tool state."""

import asyncio
import json
from typing import Any, Dict, List, Optional

from planner_api.region_store import region_store
from planner_api.simulations.sun import compute_sun_data
from planner_api.simulations.traffic import simulate_traffic
from planner_api.simulations.weather import fetch_weather
from planner_api.simulations.wind import simulate_wind


class ToolRuntime:
    def __init__(self):
        self._todos: List[str] = []
        self._done: set[int] = set()
        self._tool_events: List[str] = []
        self._finish_summary: Optional[str] = None
        self._last_simulation_results: Dict[str, Any] = {}

    def reset(self) -> None:
        self._todos = []
        self._done.clear()
        self._tool_events = []
        self._finish_summary = None

    def execute(self, name: str, args: Dict[str, Any]) -> Any:
        handler = {
            "create_todo": lambda: self._create_todo(args.get("tasks", [])),
            "task_done": lambda: self._task_done(args.get("task_index", -1)),
            "message": lambda: self._message(args.get("text", "")),
            "finish": lambda: self._finish(args.get("summary", "")),
            "get_region_summary": lambda: region_store.get_summary(),
            "query_buildings": lambda: region_store.query_buildings(
                name=args.get("name"), building_type=args.get("building_type")
            ),
            "query_roads": lambda: region_store.query_roads(
                name=args.get("name"), road_type=args.get("road_type")
            ),
            "query_features_in_area": lambda: region_store.query_features_in_area(
                args.get("polygon", [])
            ),
            "analyze_density": lambda: region_store.analyze_density(
                polygon=args.get("polygon")
            ),
            "run_simulation": lambda: self._run_simulation(args.get("type", ""), args.get("params", {})),
            "analyze_urban_plan": lambda: self._analyze_urban_plan(args.get("focus", "all")),
        }.get(name)

        if handler is None:
            output = {"error": f"No handler for tool: {name}"}
        else:
            output = handler()

        self._tool_events.append(f"{name}({json.dumps(args)}) -> {output}")
        return output

    @property
    def finish_summary(self) -> Optional[str]:
        return self._finish_summary

    @property
    def tool_events(self) -> List[str]:
        return self._tool_events.copy()

    def _create_todo(self, tasks: List[str]) -> Dict[str, Any]:
        self._todos = list(tasks)
        self._done.clear()
        return {"ok": True, "count": len(self._todos)}

    def _task_done(self, task_index: int) -> Dict[str, Any]:
        if not isinstance(task_index, int):
            return {"ok": False, "error": f"Invalid task index: {task_index}"}
        if task_index < 0 or task_index >= len(self._todos):
            return {"ok": False, "error": f"Invalid task index: {task_index}"}
        self._done.add(task_index)
        return {"ok": True, "task_index": task_index, "task": self._todos[task_index]}

    @staticmethod
    def _message(text: str) -> str:
        return text

    def _finish(self, summary: str) -> str:
        self._finish_summary = summary
        return summary

    def _run_simulation(self, sim_type: str, params: Dict[str, Any]) -> Any:
        center = region_store.center

        if sim_type == "traffic":
            roads = region_store.get_roads_for_graph()
            result = simulate_traffic(
                roads,
                time_of_day=params.get("time_of_day", "default"),
                polygon=params.get("polygon"),
            )
            self._last_simulation_results["traffic"] = result
            return {
                "type": "traffic",
                "hotspots": result.get("hotspots", []),
                "summary": result.get("summary", {}),
            }

        if sim_type == "sun":
            result = compute_sun_data(
                center[1], center[0],
                date=params.get("date", "2025-06-21"),
                hours=params.get("hours"),
            )
            self._last_simulation_results["sun"] = result
            return {
                "type": "sun",
                "summary": result.get("summary", {}),
                "seasonal_comparison": result.get("seasonal_comparison", {}),
            }

        if sim_type == "wind":
            buildings = region_store.get_buildings_for_simulation()
            loop = asyncio.get_event_loop()
            result = loop.run_until_complete(simulate_wind(center[1], center[0], buildings))
            self._last_simulation_results["wind"] = result
            return {
                "type": "wind",
                "base_wind": result.get("base_wind", {}),
                "summary": result.get("summary", {}),
                "tunnel_zones": result.get("tunnel_zones", [])[:5],
            }

        if sim_type == "weather":
            loop = asyncio.get_event_loop()
            result = loop.run_until_complete(fetch_weather(center[1], center[0]))
            self._last_simulation_results["weather"] = result
            return {
                "type": "weather",
                "current": result.get("current", {}),
                "summary": result.get("summary", {}),
            }

        return {"error": f"Unknown simulation type: {sim_type}"}

    def _analyze_urban_plan(self, focus: str = "all") -> Dict[str, Any]:
        results: Dict[str, Any] = {"focus": focus}

        density = region_store.analyze_density()
        results["density"] = density

        if focus in ("all", "traffic"):
            roads = region_store.get_roads_for_graph()
            traffic = simulate_traffic(roads, time_of_day="evening_rush")
            results["traffic"] = {
                "hotspots": traffic.get("hotspots", [])[:5],
                "summary": traffic.get("summary", {}),
            }
            self._last_simulation_results["traffic"] = traffic

        if focus in ("all", "environment"):
            center = region_store.center
            sun = compute_sun_data(center[1], center[0])
            results["sun"] = sun.get("summary", {})
            self._last_simulation_results["sun"] = sun

        results["recommendations"] = self._generate_recommendations(results)
        return results

    @staticmethod
    def _generate_recommendations(analysis: Dict[str, Any]) -> list[str]:
        recs = []
        density = analysis.get("density", {})

        if density.get("green_space_ratio", 0) < 0.05:
            recs.append("Low green space ratio detected. Consider adding parks or green corridors to improve livability and reduce urban heat island effect.")
        if density.get("walkability_score", 0) < 50:
            recs.append("Low walkability score. Consider adding pedestrian paths, widening sidewalks, or creating car-free zones.")
        if density.get("building_density_per_km2", 0) > 1000:
            recs.append("High building density. Ensure adequate ventilation corridors and public spaces between buildings.")

        traffic = analysis.get("traffic", {})
        summary = traffic.get("summary", {})
        if summary.get("congestion_ratio", 0) > 0.3:
            recs.append("High traffic congestion detected. Consider traffic calming measures, alternative routes, or public transit improvements.")

        hotspots = traffic.get("hotspots", [])
        if hotspots:
            names = [h["road_name"] for h in hotspots[:3] if h.get("road_name")]
            if names:
                recs.append(f"Worst congestion on: {', '.join(names)}. These corridors need capacity improvements or parallel routes.")

        sun = analysis.get("sun", {})
        if sun.get("winter_noon_elevation", 90) < 20:
            recs.append("Low winter sun angle. Ensure building heights allow sunlight to reach street level and public spaces during winter months.")

        if not recs:
            recs.append("Region appears well-balanced. Continue monitoring as development progresses.")

        return recs

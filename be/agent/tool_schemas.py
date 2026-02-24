"""Tool schema definitions exposed to Backboard."""

from typing import Any, Dict, List


def default_tools() -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": "create_todo",
                "description": "Create or replace task list for the current request",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "tasks": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Ordered task list",
                        }
                    },
                    "required": ["tasks"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "task_done",
                "description": "Mark a todo item as done by index",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_index": {
                            "type": "integer",
                            "description": "Task index (0-based)",
                        }
                    },
                    "required": ["task_index"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "message",
                "description": "Send a progress update or analysis message to the user",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Message text (supports markdown)",
                        }
                    },
                    "required": ["text"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "finish",
                "description": "Call when the task is fully complete",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "summary": {
                            "type": "string",
                            "description": "Final completion summary",
                        }
                    },
                    "required": ["summary"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_region_summary",
                "description": "Get a summary of the currently loaded region including counts of buildings, roads, parks, rivers, and notable named features",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "query_buildings",
                "description": "Search for buildings in the region by name or type. Returns building details including name, type, height, floors, and center coordinates.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Filter by building name (partial match, case-insensitive)",
                        },
                        "building_type": {
                            "type": "string",
                            "description": "Filter by building type (e.g., 'commercial', 'residential', 'church')",
                        },
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "query_roads",
                "description": "Search for roads in the region by name or type. Returns road details including name, type, and width.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Filter by road name (partial match, case-insensitive)",
                        },
                        "road_type": {
                            "type": "string",
                            "description": "Filter by road type (e.g., 'primary', 'residential', 'motorway')",
                        },
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "query_features_in_area",
                "description": "Get all features (buildings, roads, parks, rivers) within a polygon area. Use the lasso polygon from memory if available, or provide a custom polygon.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "polygon": {
                            "type": "array",
                            "items": {
                                "type": "array",
                                "items": {"type": "number"},
                            },
                            "description": "Polygon as array of [lon, lat] points. If omitted, uses the full region.",
                        },
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_simulation",
                "description": "Run an urban planning simulation. Types: 'traffic' (road congestion analysis), 'sun' (sun position and shadow data), 'wind' (wind flow with building effects), 'weather' (current and 7-day forecast). Returns structured results with metrics.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["traffic", "sun", "wind", "weather"],
                            "description": "Simulation type to run",
                        },
                        "params": {
                            "type": "object",
                            "description": "Optional simulation parameters. Traffic: {time_of_day: 'morning_rush'|'midday'|'evening_rush'|'night'}. Sun: {date: 'YYYY-MM-DD'}. Wind/Weather: no params needed.",
                        },
                    },
                    "required": ["type"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "analyze_density",
                "description": "Analyze urban density metrics: building density, green space ratio, road coverage, and walkability score. Can analyze the full region or a specific polygon area.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "polygon": {
                            "type": "array",
                            "items": {
                                "type": "array",
                                "items": {"type": "number"},
                            },
                            "description": "Optional polygon to analyze. If omitted, analyzes full region.",
                        },
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "analyze_urban_plan",
                "description": "Run a comprehensive urban planning analysis: runs traffic, sun, wind, weather simulations and density analysis, then returns a combined assessment with recommendations. This is the most powerful analysis tool.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "focus": {
                            "type": "string",
                            "description": "Optional focus area: 'traffic', 'environment', 'livability', or 'all' (default)",
                        },
                    },
                },
            },
        },
    ]

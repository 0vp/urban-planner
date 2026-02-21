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
                "description": "Send a progress update",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "Message text",
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
    ]

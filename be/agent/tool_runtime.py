"""Tool execution runtime and in-memory tool state."""

import json
from typing import Any, Dict, List, Optional


class ToolRuntime:
    def __init__(self):
        self._todos: List[str] = []
        self._done: set[int] = set()
        self._tool_events: List[str] = []
        self._finish_summary: Optional[str] = None

    def reset(self) -> None:
        self._todos = []
        self._done.clear()
        self._tool_events = []
        self._finish_summary = None

    def execute(self, name: str, args: Dict[str, Any]) -> Any:
        if name == "create_todo":
            output = self._create_todo(args.get("tasks", []))
        elif name == "task_done":
            output = self._task_done(args.get("task_index", -1))
        elif name == "message":
            output = self._message(args.get("text", ""))
        elif name == "finish":
            output = self._finish(args.get("summary", ""))
        else:
            output = {"error": f"No handler for tool: {name}"}

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

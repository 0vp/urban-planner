"""Minimal Backboard agent orchestrator."""

import json
import os

from typing import Any, Awaitable, Callable, Dict, List, Optional

from backboard import BackboardClient

from prompt.system import UP_SYSTEM_PROMPT

from .config import ASSISTANT_ID, LLM_PROVIDER, MODEL_NAME, TOOL_ONLY_NUDGE
from .models import RunResult
from .tool_runtime import ToolRuntime
from .tool_schemas import default_tools


class WBAgent:
    def __init__(
        self,
        api_key: Optional[str] = None,
        max_iterations: int = 1000000,
        assistant_id: Optional[str] = None,
    ):
        self.api_key = api_key or os.getenv("BACKBOARD_API_KEY")
        if not self.api_key:
            raise ValueError("BACKBOARD_API_KEY is required")

        self.assistant_id = assistant_id or ASSISTANT_ID
        self.client = BackboardClient(self.api_key)
        self.assistant = None
        self.thread = None
        self.max_iterations = max_iterations
        self.runtime = ToolRuntime()

    async def create_assistant(
        self,
        name: str = "UP Agent",
        description: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Any:
        if self.assistant is not None:
            return self.assistant

        desired_description = description or UP_SYSTEM_PROMPT
        desired_tools = tools or default_tools()

        if self.assistant_id:
            self.assistant = await self.client.get_assistant(self.assistant_id)
            existing_tools = getattr(self.assistant, "tools", None) or []
            if not existing_tools:
                self.assistant = await self.client.update_assistant(
                    self.assistant_id,
                    description=desired_description,
                    tools=desired_tools,
                )
            return self.assistant

        self.assistant = await self.client.create_assistant(
            name=name,
            description=desired_description,
            tools=desired_tools,
        )
        self.assistant_id = getattr(self.assistant, "assistant_id", None)
        return self.assistant

    async def create_thread(self) -> Any:
        if not self.assistant:
            raise ValueError("Assistant must be created first")
        self.thread = await self.client.create_thread(str(self.assistant.assistant_id))
        return self.thread

    async def send_message(self, content: str, stream: bool = False, memory: Optional[str] = None) -> RunResult:
        return await self.send_message_with_events(content=content, stream=stream, memory=memory)

    async def send_message_with_events(
        self,
        content: str,
        stream: bool = False,
        memory: Optional[str] = None,
        event_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    ) -> RunResult:
        if not self.thread:
            raise ValueError("Thread must be created first")

        self.runtime.reset()

        response = await self.client.add_message(
            thread_id=str(self.thread.thread_id),
            content=content,
            llm_provider=LLM_PROVIDER,
            model_name=MODEL_NAME,
            stream=stream,
            memory=memory,
        )

        for attempt in range(self.max_iterations):
            if self._requires_action(response):
                response = await self._handle_tool_calls(response, event_callback=event_callback)

                # If the same run still has pending tool calls, keep consuming them.
                if self._requires_action(response):
                    continue

            if self.runtime.finish_summary is not None:
                return RunResult(
                    summary=self.runtime.finish_summary,
                    tool_events=self.runtime.tool_events,
                )

            response_text = self._extract_response_text(response)
            if response_text is not None:
                return RunResult(
                    summary=response_text,
                    tool_events=self.runtime.tool_events,
                    raw_response=response_text,
                )

            if attempt == self.max_iterations - 1:
                break

            response = await self.client.add_message(
                thread_id=str(self.thread.thread_id),
                content=TOOL_ONLY_NUDGE,
                llm_provider=LLM_PROVIDER,
                model_name=MODEL_NAME,
                stream=stream,
                memory=memory,
            )

        return RunResult(
            summary=self.runtime.finish_summary,
            tool_events=self.runtime.tool_events,
            raw_response=getattr(response, "content", None),
        )

    async def _handle_tool_calls(
        self,
        response: Any,
        event_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    ) -> Any:
        tool_outputs: List[Dict[str, str]] = []

        for tool_call in (getattr(response, "tool_calls", None) or []):
            tool_call_id, name, args = self._parse_tool_call(tool_call)
            output = self.runtime.execute(name, args)

            event_line = self.runtime.tool_events[-1] if self.runtime.tool_events else None
            if event_callback is not None:
                await event_callback(
                    {
                        "toolCallId": tool_call_id,
                        "name": name,
                        "args": args,
                        "output": output,
                        "eventLine": event_line,
                    }
                )

            tool_outputs.append(
                {
                    "tool_call_id": tool_call_id,
                    "output": json.dumps(output) if isinstance(output, (dict, list)) else str(output),
                }
            )

        return await self.client.submit_tool_outputs(
            thread_id=str(self.thread.thread_id),
            run_id=str(response.run_id),
            tool_outputs=tool_outputs,
            stream=False,
        )

    @staticmethod
    def _requires_action(response: Any) -> bool:
        return getattr(response, "status", None) == "REQUIRES_ACTION" and bool(getattr(response, "tool_calls", None))

    @staticmethod
    def _extract_response_text(response: Any) -> Optional[str]:
        content = None

        if isinstance(response, dict):
            content = response.get("content") or response.get("message")
        else:
            content = getattr(response, "content", None) or getattr(response, "message", None)

        if isinstance(content, str):
            content = content.strip()
            return content or None

        return None

    @staticmethod
    def _parse_tool_call(tool_call: Any) -> tuple[str, str, Dict[str, Any]]:
        if isinstance(tool_call, dict):
            tool_call_id = str(tool_call.get("id", ""))
            function = tool_call.get("function", {})
            if isinstance(function, dict):
                name = function.get("name", "")
                args = function.get("parsed_arguments")
                if args is None:
                    raw_args = function.get("arguments")
                    if isinstance(raw_args, str):
                        try:
                            args = json.loads(raw_args)
                        except json.JSONDecodeError:
                            args = {}
            else:
                name = getattr(function, "name", "")
                args = getattr(function, "parsed_arguments", None)
                if args is None:
                    raw_args = getattr(function, "arguments", None)
                    if isinstance(raw_args, str):
                        try:
                            args = json.loads(raw_args)
                        except json.JSONDecodeError:
                            args = {}
            if not isinstance(args, dict):
                args = {}
            return tool_call_id, name, args

        tool_call_id = str(getattr(tool_call, "id", ""))
        function = getattr(tool_call, "function", None)
        name = getattr(function, "name", "")
        args = getattr(function, "parsed_arguments", None)
        if args is None:
            raw_args = getattr(function, "arguments", None)
            if isinstance(raw_args, str):
                try:
                    args = json.loads(raw_args)
                except json.JSONDecodeError:
                    args = {}
        if not isinstance(args, dict):
            args = {}
        return tool_call_id, name, args

    async def close(self) -> None:
        await self.client.aclose()

    async def __aenter__(self) -> "WBAgent":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.close()

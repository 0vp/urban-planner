from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from agent.models import RunResult
from main import app
import planner_api.agent_ws as agent_ws


class FakeAgent:
    instances: list["FakeAgent"] = []

    def __init__(self, *_args, **_kwargs):
        self.assistant_name = None
        self.assistant = None
        self.thread_created = False
        self.messages: list[tuple[str, str | None]] = []
        self.closed = False
        FakeAgent.instances.append(self)

    async def create_assistant(self, name: str = "UP Agent", **_kwargs):
        self.assistant_name = name
        self.assistant = type("Assistant", (), {"assistant_id": uuid.UUID("12345678-1234-5678-1234-567812345678")})()
        return object()

    async def create_thread(self):
        self.thread_created = True
        return object()

    async def send_message_with_events(self, content: str, stream: bool = False, memory: str | None = None, event_callback=None):
        self.messages.append((content, memory))
        if event_callback is not None:
            await event_callback({
                "toolCallId": "tc_1",
                "name": "message",
                "args": {"text": content},
                "output": content,
                "eventLine": f"message({{\"text\": \"{content}\"}}) -> {content}",
            })
        return RunResult(summary="done", tool_events=[f"message:{content}"], raw_response="raw")

    async def close(self):
        self.closed = True


def test_agent_websocket_run(monkeypatch):
    FakeAgent.instances = []
    monkeypatch.setattr(agent_ws, "WBAgent", FakeAgent)

    client = TestClient(app)
    with client.websocket_connect("/api/agent/ws?assistant_name=PlannerWB") as websocket:
        ready = websocket.receive_json()
        assert ready == {"type": "ready", "assistantId": "12345678-1234-5678-1234-567812345678"}

        websocket.send_json({"prompt": "  optimize traffic  ", "memory": "city-state", "requestId": "req-1"})
        started = websocket.receive_json()
        assert started == {"type": "run_started", "requestId": "req-1"}

        tool_event = websocket.receive_json()
        assert tool_event["type"] == "tool_event"
        assert tool_event["requestId"] == "req-1"
        assert tool_event["name"] == "message"

        result = websocket.receive_json()

        assert result["type"] == "result"
        assert result["requestId"] == "req-1"
        assert result["summary"] == "done"
        assert result["toolEvents"] == ["message:optimize traffic"]
        assert result["rawResponse"] == "raw"

    instance = FakeAgent.instances[0]
    assert instance.thread_created is True
    assert instance.messages == [("optimize traffic", "city-state")]
    assert instance.closed is True


def test_agent_websocket_rejects_bad_prompt(monkeypatch):
    FakeAgent.instances = []
    monkeypatch.setattr(agent_ws, "WBAgent", FakeAgent)

    client = TestClient(app)
    with client.websocket_connect("/api/agent/ws") as websocket:
        websocket.receive_json()

        websocket.send_json({"prompt": ""})
        error = websocket.receive_json()
        assert error["type"] == "error"
        assert "prompt" in error["error"]

        websocket.send_json({"prompt": "plan roads"})
        started = websocket.receive_json()
        assert started["type"] == "run_started"
        assert isinstance(started["requestId"], str)

        tool_event = websocket.receive_json()
        assert tool_event["type"] == "tool_event"

        result = websocket.receive_json()
        assert result["type"] == "result"

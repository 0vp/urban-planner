from __future__ import annotations

import asyncio
from types import SimpleNamespace

import agent.agent as agent_module


class FakeBackboardClient:
    def __init__(self, *_args, **_kwargs):
        self.updated = False
        self.add_message_calls = 0

    async def get_assistant(self, assistant_id: str):
        return SimpleNamespace(assistant_id=assistant_id, tools=[])

    async def update_assistant(self, assistant_id: str, name=None, description=None, tools=None):
        self.updated = True
        return SimpleNamespace(assistant_id=assistant_id, tools=tools or [], description=description)

    async def create_assistant(self, name: str, description: str, tools):
        return SimpleNamespace(assistant_id="created-assistant", name=name, description=description, tools=tools)

    async def create_thread(self, assistant_id: str):
        return SimpleNamespace(thread_id=f"thread-{assistant_id}")

    async def add_message(self, **_kwargs):
        self.add_message_calls += 1
        return SimpleNamespace(status="COMPLETED", tool_calls=[], content="plain text response")

    async def submit_tool_outputs(self, **_kwargs):
        raise AssertionError("submit_tool_outputs should not be called in this test")

    async def aclose(self):
        return None


def test_existing_assistant_without_tools_gets_synced(monkeypatch):
    fake_client = FakeBackboardClient()
    monkeypatch.setattr(agent_module, "BackboardClient", lambda *_args, **_kwargs: fake_client)

    wb_agent = agent_module.WBAgent(api_key="test-key", assistant_id="assistant-123")
    assistant = asyncio.run(wb_agent.create_assistant())

    assert assistant.assistant_id == "assistant-123"
    assert fake_client.updated is True
    assert assistant.tools


def test_plain_text_response_does_not_loop_forever(monkeypatch):
    fake_client = FakeBackboardClient()
    monkeypatch.setattr(agent_module, "BackboardClient", lambda *_args, **_kwargs: fake_client)

    wb_agent = agent_module.WBAgent(api_key="test-key", assistant_id="assistant-plain", max_iterations=5)

    asyncio.run(wb_agent.create_assistant())
    asyncio.run(wb_agent.create_thread())
    result = asyncio.run(wb_agent.send_message_with_events(content="hi"))

    assert result.summary == "plain text response"
    assert result.raw_response == "plain text response"
    assert result.tool_events == []
    assert fake_client.add_message_calls == 1

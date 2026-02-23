from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent import WBAgent


router = APIRouter(prefix="/api/agent", tags=["agent"])


def _to_json_safe(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


@router.websocket("/ws")
async def wb_agent_websocket(websocket: WebSocket) -> None:
    await websocket.accept()

    assistant_name = websocket.query_params.get("assistant_name") or "UP Agent"
    agent: WBAgent | None = None

    try:
        agent = WBAgent()
        await agent.create_assistant(name=assistant_name)
        await agent.create_thread()

        assistant_id = getattr(agent.assistant, "assistant_id", None)

        await websocket.send_json(
            {
                "type": "ready",
                "assistantId": str(assistant_id) if assistant_id is not None else None,
            }
        )

        while True:
            payload = await websocket.receive_json()

            if not isinstance(payload, dict):
                await websocket.send_json(
                    {
                        "type": "error",
                        "error": "Payload must be a JSON object",
                    }
                )
                continue

            prompt = payload.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                await websocket.send_json(
                    {
                        "type": "error",
                        "error": "Field 'prompt' must be a non-empty string",
                    }
                )
                continue

            memory = payload.get("memory")
            if memory is not None and not isinstance(memory, str):
                await websocket.send_json(
                    {
                        "type": "error",
                        "error": "Field 'memory' must be a string when provided",
                    }
                )
                continue

            request_id = payload.get("requestId")
            if request_id is None:
                request_id = str(uuid.uuid4())
            elif not isinstance(request_id, str):
                request_id = str(request_id)

            await websocket.send_json(
                {
                    "type": "run_started",
                    "requestId": request_id,
                }
            )

            async def _on_tool_event(event: dict) -> None:
                await websocket.send_json(
                    {
                        "type": "tool_event",
                        "requestId": request_id,
                        "toolCallId": event.get("toolCallId"),
                        "name": event.get("name"),
                        "args": _to_json_safe(event.get("args")),
                        "output": _to_json_safe(event.get("output")),
                        "eventLine": event.get("eventLine"),
                    }
                )

            result = await agent.send_message_with_events(
                content=prompt.strip(),
                memory=memory,
                event_callback=_on_tool_event,
            )
            await websocket.send_json(
                {
                    "type": "result",
                    "requestId": request_id,
                    "summary": result.summary,
                    "toolEvents": result.tool_events,
                    "rawResponse": result.raw_response,
                }
            )
    except WebSocketDisconnect:
        return
    except Exception as exc:
        try:
            await websocket.send_json(
                {
                    "type": "error",
                    "error": "Agent websocket failed",
                    "details": str(exc),
                }
            )
            await websocket.close(code=1011)
        except RuntimeError:
            pass
    finally:
        if agent is not None:
            await agent.close()

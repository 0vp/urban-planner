from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from agent import WBAgent


router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.websocket("/ws")
async def wb_agent_websocket(websocket: WebSocket) -> None:
    await websocket.accept()

    assistant_name = websocket.query_params.get("assistant_name") or "UP Agent"
    agent: WBAgent | None = None

    try:
        agent = WBAgent()
        await agent.create_assistant(name=assistant_name)
        await agent.create_thread()

        await websocket.send_json(
            {
                "type": "ready",
                "assistantName": assistant_name,
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

            result = await agent.send_message(content=prompt.strip(), memory=memory)
            await websocket.send_json(
                {
                    "type": "result",
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

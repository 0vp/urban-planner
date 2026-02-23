from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel


router = APIRouter(prefix="/api/backboard", tags=["backboard"])

BACKBOARD_BASE_URL = "https://app.backboard.io/api"
BACKBOARD_TIMEOUT_SECONDS = 60.0


def _backboard_api_key() -> str:
    return os.getenv("BACKBOARD_API_KEY", "").strip()


def _ensure_api_key() -> str:
    api_key = _backboard_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="BACKBOARD_API_KEY is not configured")
    return api_key


def _backboard_headers(*, include_content_type: bool = True) -> dict[str, str]:
    headers = {"X-API-Key": _ensure_api_key()}
    if include_content_type:
        headers["Content-Type"] = "application/json"
    return headers


def _coerce_detail(response: httpx.Response) -> Any:
    try:
        payload = response.json()
    except ValueError:
        text = response.text.strip()
        return text or f"HTTP {response.status_code}"
    if isinstance(payload, dict):
        return payload.get("detail") or payload.get("message") or payload
    return payload


async def proxy_request(method: str, path: str, json_data: dict | None = None, params: dict | None = None):
    try:
        async with httpx.AsyncClient(base_url=BACKBOARD_BASE_URL, timeout=BACKBOARD_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method=method,
                url=f"/{path}",
                json=json_data,
                params=params,
                headers=_backboard_headers(),
            )
        response.raise_for_status()
        if not response.content:
            return {}
        return response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=_coerce_detail(exc.response)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Backboard API unavailable: {exc}") from exc


async def proxy_file_upload(method: str, path: str, file: UploadFile, extra_data: dict | None = None):
    try:
        file_content = await file.read()
        files = {
            "file": (
                file.filename,
                file_content,
                file.content_type or "application/octet-stream",
            )
        }
        async with httpx.AsyncClient(base_url=BACKBOARD_BASE_URL, timeout=BACKBOARD_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method=method,
                url=f"/{path}",
                files=files,
                data=extra_data or {},
                headers=_backboard_headers(include_content_type=False),
            )
        response.raise_for_status()
        if not response.content:
            return {}
        return response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=_coerce_detail(exc.response)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Backboard API unavailable: {exc}") from exc


async def get_all_models() -> list[dict]:
    models_response = await proxy_request("GET", "models")
    models = models_response.get("models") if isinstance(models_response, dict) else models_response
    return models if isinstance(models, list) else []


def filter_embedding_models(models: list[dict]) -> list[dict]:
    return [model for model in models if model.get("model_type") == "embedding"]


def find_embedding_model(models: list[dict], model_id: str) -> dict | None:
    for model in models:
        provider = model.get("provider")
        name = model.get("name")
        candidates = {
            model.get("id"),
            name,
            f"{provider}/{name}" if provider and name else None,
        }
        if model_id in candidates:
            return model
    return None


class AssistantCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    model: Optional[str] = None
    instructions: Optional[str] = ""


class AssistantUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    instructions: Optional[str] = None


class ThreadCreate(BaseModel):
    metadata: Optional[dict] = None


class MessageCreate(BaseModel):
    content: str
    llm_provider: Optional[str] = None
    model_name: Optional[str] = None
    memory: Optional[str] = None


class MemoryCreate(BaseModel):
    content: str
    metadata: Optional[dict] = None


class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    metadata: Optional[dict] = None


class ToolOutput(BaseModel):
    tool_call_id: str
    output: str


class ToolOutputsSubmit(BaseModel):
    tool_outputs: list[ToolOutput]


@router.post("/assistants")
async def create_assistant(data: AssistantCreate):
    return await proxy_request("POST", "assistants", data.model_dump(exclude_none=True))


@router.get("/assistants")
async def list_assistants():
    return await proxy_request("GET", "assistants")


@router.get("/assistants/{assistant_id}")
async def get_assistant(assistant_id: str):
    return await proxy_request("GET", f"assistants/{assistant_id}")


@router.put("/assistants/{assistant_id}")
async def update_assistant(assistant_id: str, data: AssistantUpdate):
    return await proxy_request("PUT", f"assistants/{assistant_id}", data.model_dump(exclude_unset=True))


@router.delete("/assistants/{assistant_id}")
async def delete_assistant(assistant_id: str):
    return await proxy_request("DELETE", f"assistants/{assistant_id}")


@router.post("/assistants/{assistant_id}/threads")
async def create_thread_for_assistant(assistant_id: str, data: ThreadCreate = ThreadCreate()):
    return await proxy_request("POST", f"assistants/{assistant_id}/threads", data.model_dump())


@router.get("/assistants/{assistant_id}/threads")
async def list_threads_for_assistant(assistant_id: str):
    return await proxy_request("GET", f"assistants/{assistant_id}/threads")


@router.get("/assistants/{assistant_id}/documents")
async def list_assistant_documents(assistant_id: str):
    return await proxy_request("GET", f"assistants/{assistant_id}/documents")


@router.post("/assistants/{assistant_id}/documents")
async def upload_document_to_assistant(assistant_id: str, file: UploadFile = File(...)):
    return await proxy_file_upload("POST", f"assistants/{assistant_id}/documents", file)


@router.get("/threads")
async def list_threads():
    return await proxy_request("GET", "threads")


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: str):
    return await proxy_request("GET", f"threads/{thread_id}")


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str):
    return await proxy_request("DELETE", f"threads/{thread_id}")


@router.post("/threads/{thread_id}/messages")
async def add_message_to_thread(thread_id: str, data: MessageCreate):
    return await proxy_request("POST", f"threads/{thread_id}/messages", data.model_dump(exclude_none=True))


@router.get("/threads/{thread_id}/messages")
async def list_messages_for_thread(thread_id: str):
    return await proxy_request("GET", f"threads/{thread_id}/messages")


@router.get("/threads/{thread_id}/documents")
async def list_thread_documents(thread_id: str):
    return await proxy_request("GET", f"threads/{thread_id}/documents")


@router.post("/threads/{thread_id}/documents")
async def upload_document_to_thread(thread_id: str, file: UploadFile = File(...)):
    return await proxy_file_upload("POST", f"threads/{thread_id}/documents", file)


@router.post("/threads/{thread_id}/submit_tool_outputs")
async def submit_tool_outputs(thread_id: str, data: ToolOutputsSubmit):
    return await proxy_request("POST", f"threads/{thread_id}/submit_tool_outputs", data.model_dump())


@router.get("/documents/{document_id}/status")
async def get_document_status(document_id: str):
    return await proxy_request("GET", f"documents/{document_id}/status")


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    return await proxy_request("DELETE", f"documents/{document_id}")


@router.get("/assistants/{assistant_id}/memories")
async def list_memories_for_assistant(assistant_id: str):
    return await proxy_request("GET", f"assistants/{assistant_id}/memories")


@router.post("/assistants/{assistant_id}/memories")
async def add_memory_to_assistant(assistant_id: str, data: MemoryCreate):
    return await proxy_request("POST", f"assistants/{assistant_id}/memories", data.model_dump())


@router.get("/assistants/{assistant_id}/memories/{memory_id}")
async def get_memory(assistant_id: str, memory_id: str):
    return await proxy_request("GET", f"assistants/{assistant_id}/memories/{memory_id}")


@router.put("/assistants/{assistant_id}/memories/{memory_id}")
async def update_memory(assistant_id: str, memory_id: str, data: MemoryUpdate):
    return await proxy_request("PUT", f"assistants/{assistant_id}/memories/{memory_id}", data.model_dump(exclude_unset=True))


@router.delete("/assistants/{assistant_id}/memories/{memory_id}")
async def delete_memory(assistant_id: str, memory_id: str):
    return await proxy_request("DELETE", f"assistants/{assistant_id}/memories/{memory_id}")


@router.get("/memories")
async def list_memories():
    return {"memories": [], "total_count": 0}


@router.get("/memories/stats")
async def get_memory_stats():
    return {"total_memories": 0, "total_assistants": 0}


@router.get("/memories/operations/{operation_id}")
async def get_memory_operation_status(operation_id: str):
    return await proxy_request("GET", f"memories/operations/{operation_id}")


@router.get("/models")
async def list_models():
    return await proxy_request("GET", "models")


@router.get("/models/providers")
async def list_model_providers():
    return await proxy_request("GET", "models/providers")


@router.get("/models/embedding")
async def list_embedding_models_v2():
    embedding_models = filter_embedding_models(await get_all_models())
    return {"models": embedding_models, "total": len(embedding_models)}


@router.get("/models/embedding/{model_id:path}")
async def get_embedding_model_v2(model_id: str):
    model = find_embedding_model(filter_embedding_models(await get_all_models()), model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Embedding model '{model_id}' not found")
    return model


@router.get("/providers")
async def list_providers():
    return await proxy_request("GET", "models/providers")


@router.get("/providers/{provider_id}/models")
async def list_models_by_provider(provider_id: str):
    models = await get_all_models()
    filtered = [model for model in models if model.get("provider") == provider_id]
    return {"models": filtered}


@router.get("/embedding-models")
async def list_embedding_models():
    return await list_embedding_models_v2()


@router.get("/embedding-models/{model_id:path}")
async def get_embedding_model(model_id: str):
    return await get_embedding_model_v2(model_id)


@router.get("/embedding-providers")
async def list_embedding_providers():
    embedding_models = filter_embedding_models(await get_all_models())
    provider_ids = sorted({model.get("provider") for model in embedding_models if model.get("provider")})
    return {
        "providers": [
            {"id": provider_id, "name": provider_id}
            for provider_id in provider_ids
        ]
    }


@router.get("/models/{model_id:path}")
async def get_model(model_id: str):
    if model_id == "providers":
        return await list_model_providers()
    if model_id == "embedding":
        return await list_embedding_models_v2()
    if model_id.startswith("embedding/"):
        return await get_embedding_model_v2(model_id.split("embedding/", 1)[1])
    return await proxy_request("GET", f"models/{model_id}")

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import httpx


LOGGER = logging.getLogger(__name__)

BACKBOARD_BASE_URL = os.getenv("BACKBOARD_BASE_URL", "https://app.backboard.io/api").rstrip("/")
BACKBOARD_TIMEOUT_SECONDS = 60.0

DEFAULT_DOCS_DIR = Path(__file__).resolve().parent.parent / "docs" / "on-qc-national"


def _is_enabled() -> bool:
    raw = os.getenv("BACKBOARD_SYNC_STARTUP_DOCS", "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _resolve_docs_dir() -> Path:
    configured = os.getenv("BACKBOARD_STARTUP_DOCS_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    if DEFAULT_DOCS_DIR.exists():
        return DEFAULT_DOCS_DIR

    return (Path(__file__).resolve().parent.parent / "docs").resolve()


def _iter_documents(directory: Path) -> list[Path]:
    if not directory.exists() or not directory.is_dir():
        return []

    return sorted(
        path
        for path in directory.rglob("*")
        if path.is_file() and not path.name.startswith(".")
    )


def _extract_existing_filenames(payload: Any) -> set[str]:
    if isinstance(payload, dict):
        items = payload.get("documents")
    elif isinstance(payload, list):
        items = payload
    else:
        items = []

    if not isinstance(items, list):
        return set()

    names: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        for key in ("filename", "file_name", "name", "title"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                names.add(value.strip())
                break

    return names


async def sync_assistant_startup_documents() -> dict[str, int]:
    if not _is_enabled():
        return {"found": 0, "existing": 0, "uploaded": 0, "failed": 0}

    api_key = os.getenv("BACKBOARD_API_KEY", "").strip()
    assistant_id = os.getenv("BACKBOARD_ASSISTANT_ID", "").strip()

    if not api_key or not assistant_id:
        LOGGER.info("Skipping startup docs sync: BACKBOARD_API_KEY or BACKBOARD_ASSISTANT_ID not set")
        return {"found": 0, "existing": 0, "uploaded": 0, "failed": 0}

    docs_dir = _resolve_docs_dir()
    files_to_sync = _iter_documents(docs_dir)
    if not files_to_sync:
        LOGGER.info("Skipping startup docs sync: no files found in %s", docs_dir)
        return {"found": 0, "existing": 0, "uploaded": 0, "failed": 0}

    headers = {"X-API-Key": api_key}

    try:
        async with httpx.AsyncClient(base_url=BACKBOARD_BASE_URL, timeout=BACKBOARD_TIMEOUT_SECONDS) as client:
            response = await client.get(f"/assistants/{assistant_id}/documents", headers=headers)
            response.raise_for_status()
            existing_filenames = _extract_existing_filenames(response.json())

            uploaded = 0
            failed = 0

            for path in files_to_sync:
                filename = path.name
                if filename in existing_filenames:
                    continue

                try:
                    payload = path.read_bytes()
                    upload_response = await client.post(
                        f"/assistants/{assistant_id}/documents",
                        headers=headers,
                        files={
                            "file": (
                                filename,
                                payload,
                                "application/octet-stream",
                            )
                        },
                    )
                    upload_response.raise_for_status()
                    uploaded += 1
                    existing_filenames.add(filename)
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    LOGGER.warning("Failed uploading startup doc %s: %s", path, exc)
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Startup docs sync skipped after Backboard request failure: %s", exc)
        return {
            "found": len(files_to_sync),
            "existing": 0,
            "uploaded": 0,
            "failed": 0,
        }

    LOGGER.info(
        "Startup docs sync complete (dir=%s, found=%s, existing=%s, uploaded=%s, failed=%s)",
        docs_dir,
        len(files_to_sync),
        len(existing_filenames) - uploaded,
        uploaded,
        failed,
    )

    return {
        "found": len(files_to_sync),
        "existing": len(existing_filenames) - uploaded,
        "uploaded": uploaded,
        "failed": failed,
    }

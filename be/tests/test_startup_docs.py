from __future__ import annotations

import asyncio

import planner_api.startup_docs as startup_docs


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class _RecordingAsyncClient:
    uploaded_filenames: list[str] = []

    def __init__(self, *_args, **_kwargs):
        self.uploaded_filenames = []
        _RecordingAsyncClient.uploaded_filenames = self.uploaded_filenames

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, *_args, **_kwargs):
        return _FakeResponse({"documents": [{"filename": "already.pdf"}]})

    async def post(self, *_args, **kwargs):
        file_tuple = kwargs["files"]["file"]
        self.uploaded_filenames.append(file_tuple[0])
        return _FakeResponse({"ok": True})


def test_startup_sync_uploads_only_missing_docs(tmp_path, monkeypatch):
    (tmp_path / "already.pdf").write_bytes(b"already")
    (tmp_path / "new.pdf").write_bytes(b"new")
    (tmp_path / "notes.md").write_text("# notes", encoding="utf-8")

    monkeypatch.setenv("BACKBOARD_SYNC_STARTUP_DOCS", "1")
    monkeypatch.setenv("BACKBOARD_API_KEY", "test-key")
    monkeypatch.setenv("BACKBOARD_ASSISTANT_ID", "assistant-1")
    monkeypatch.setenv("BACKBOARD_STARTUP_DOCS_DIR", str(tmp_path))
    monkeypatch.setattr(startup_docs.httpx, "AsyncClient", _RecordingAsyncClient)

    result = asyncio.run(startup_docs.sync_assistant_startup_documents())

    assert result["found"] == 3
    assert result["uploaded"] == 2
    assert result["failed"] == 0
    assert sorted(_RecordingAsyncClient.uploaded_filenames) == ["new.pdf", "notes.md"]


def test_startup_sync_skips_when_missing_required_env(monkeypatch):
    monkeypatch.delenv("BACKBOARD_API_KEY", raising=False)
    monkeypatch.delenv("BACKBOARD_ASSISTANT_ID", raising=False)
    monkeypatch.setenv("BACKBOARD_SYNC_STARTUP_DOCS", "1")

    def _should_not_create_client(*_args, **_kwargs):
        raise AssertionError("httpx.AsyncClient should not be created when required env vars are missing")

    monkeypatch.setattr(startup_docs.httpx, "AsyncClient", _should_not_create_client)

    result = asyncio.run(startup_docs.sync_assistant_startup_documents())

    assert result == {"found": 0, "existing": 0, "uploaded": 0, "failed": 0}

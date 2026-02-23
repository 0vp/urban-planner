from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
import planner_api.backboard as backboard


def test_memories_global_endpoint_returns_empty_payload():
    client = TestClient(app)

    response = client.get('/api/backboard/memories')

    assert response.status_code == 200
    assert response.json() == {'memories': [], 'total_count': 0}


def test_embedding_models_endpoint_filters_non_embedding_models(monkeypatch):
    async def fake_get_all_models():
        return [
            {'id': 'openai/gpt-5', 'model_type': 'chat', 'provider': 'openai', 'name': 'gpt-5'},
            {'id': 'openai/text-embedding-3-large', 'model_type': 'embedding', 'provider': 'openai', 'name': 'text-embedding-3-large'},
        ]

    monkeypatch.setattr(backboard, 'get_all_models', fake_get_all_models)

    client = TestClient(app)
    response = client.get('/api/backboard/models/embedding')

    assert response.status_code == 200
    body = response.json()
    assert body['total'] == 1
    assert body['models'][0]['id'] == 'openai/text-embedding-3-large'


def test_embedding_model_endpoint_returns_404_when_missing(monkeypatch):
    async def fake_get_all_models():
        return [
            {'id': 'openai/text-embedding-3-small', 'model_type': 'embedding', 'provider': 'openai', 'name': 'text-embedding-3-small'},
        ]

    monkeypatch.setattr(backboard, 'get_all_models', fake_get_all_models)

    client = TestClient(app)
    response = client.get('/api/backboard/models/embedding/does-not-exist')

    assert response.status_code == 404
    assert "does-not-exist" in response.json()['detail']


def test_proxied_endpoint_requires_backboard_api_key(monkeypatch):
    monkeypatch.delenv('BACKBOARD_API_KEY', raising=False)

    client = TestClient(app)
    response = client.get('/api/backboard/assistants')

    assert response.status_code == 500
    assert response.json()['detail'] == 'BACKBOARD_API_KEY is not configured'

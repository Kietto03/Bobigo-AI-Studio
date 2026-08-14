from fastapi.testclient import TestClient

from backend.app import app


def test_index_served():
    with TestClient(app) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "Bobigo" in resp.text


def test_websearch_requires_query():
    with TestClient(app) as client:
        resp = client.post("/api/websearch", json={})
        assert resp.status_code == 400


def test_chat_returns_sse_when_llm_down():
    with TestClient(app) as client:
        resp = client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        assert resp.status_code == 200
        assert "data:" in resp.text
        assert "[DONE]" in resp.text

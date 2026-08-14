from fastapi.testclient import TestClient

from backend.app import app


def test_health_endpoint_shape():
    with TestClient(app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "llm_ready" in data
        assert "message" in data
        assert "jinja" in data
        assert "ok" in data

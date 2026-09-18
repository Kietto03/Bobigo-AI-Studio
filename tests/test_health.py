import pytest
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
        assert "context_window" in data
        assert "reply_reserve" in data


@pytest.mark.anyio
async def test_probe_llm_extracts_n_ctx_from_props():
    import httpx
    from backend.health import get_active_context_window, probe_llm

    def handler(request: httpx.Request):
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "test-model"}]})
        if request.url.path == "/props":
            return httpx.Response(200, json={
                "chat_template": "{% for m in messages %}{{ m.content }}{% endfor %}",
                "default_generation_settings": {"n_ctx": 16384},
            })
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:11434") as client:
        res = await probe_llm(client)
        assert res["ok"] is True
        assert res["model"] == "test-model"
        assert res["context_window"] == 16384
        assert res["jinja"] is True
        assert get_active_context_window() == 16384


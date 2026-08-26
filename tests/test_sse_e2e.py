"""End-to-end agent streaming through the real FastAPI route with a fake LLM.

httpx.MockTransport replaces app.state.http's transport so the upstream
llama-server is fully scripted — no network, no subprocesses.
"""

import json

import httpx
from fastapi.testclient import TestClient

from backend.app import app


def _sse_events(text: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        if line.startswith("data: ") and line.strip() != "data: [DONE]":
            out.append(json.loads(line[6:]))
    return out


def test_agent_sse_end_to_end_with_fake_llm(monkeypatch):
    """FastAPI route → agent loop → scripted upstream, incl. one calculator call."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        # Startup health probes from lifespan hit the same client.
        if path.endswith(("/models", "/props")):
            return httpx.Response(200, json={"data": [{"id": "fake-model"}]})
        payload = json.loads(request.content or b"{}")
        # Tools remain advertised on every turn — branch on whether the agent
        # has ALREADY run a tool (role=tool present) to script the final answer.
        if any(m.get("role") == "tool" for m in payload.get("messages") or []):
            body = (
                'data: {"choices":[{"delta":{"content":"Kết quả là 4"}}]}\n\n'
                'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
                "data: [DONE]\n\n"
            )
        else:
            body = (
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1",'
                '"function":{"name":"calculator",'
                '"arguments":"{\\"expression\\":\\"2+2\\"}"}}]}}]}\n\n'
                'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
            )
        return httpx.Response(200, content=body.encode())

    real_client = httpx.AsyncClient

    def patched(*args, **kwargs):
        kwargs.setdefault("transport", httpx.MockTransport(handler))
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", patched)

    with TestClient(app) as client:
        resp = client.post(
            "/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": "2+2?"}],
                "stream": True,
                "agent_tools": True,
            },
        )

    assert resp.status_code == 200
    events = _sse_events(resp.text)
    deltas = [(e.get("choices") or [{}])[0].get("delta") or {} for e in events]

    tool_events = [d for d in deltas if d.get("tool_events")]
    assert tool_events, "expected at least one tool_events frame"
    assert tool_events[0]["tool_events"][0]["name"] == "calculator"
    assert "2+2" in tool_events[0]["tool_events"][0]["arguments"]

    content = "".join(d.get("content") or "" for d in deltas)
    assert "4" in content
    assert resp.text.count("[DONE]") == 1

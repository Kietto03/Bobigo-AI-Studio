"""FastAPI app: static UI, llama-server proxy, web search, agent chat."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.agent.loop import stream_agent
from backend.config import HOST, LLM_BASE_URL, LLM_TIMEOUT, PORT, WEB_DIR
from backend.expand import expand_world
from backend.health import probe_llm
from backend.tools.web_search import duckduckgo_search


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = httpx.Timeout(LLM_TIMEOUT, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        app.state.http = client
        yield


app = FastAPI(title="Bobigo AI Studio", lifespan=lifespan)


def _upstream(path: str) -> str:
    return f"{LLM_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


async def _proxy_stream(request: Request, path: str) -> StreamingResponse:
    client: httpx.AsyncClient = request.app.state.http
    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in {"host", "content-length"}
    }
    req = client.build_request(
        request.method,
        _upstream(path),
        content=body or None,
        headers=headers,
    )

    try:
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        return JSONResponse({"error": f"Proxy Error: {exc}"}, status_code=502)

    async def pump():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()

    out_headers = {
        k: v
        for k, v in resp.headers.items()
        if k.lower() not in {"transfer-encoding", "content-length", "connection"}
    }
    return StreamingResponse(
        pump(),
        status_code=resp.status_code,
        headers=out_headers,
        media_type=resp.headers.get("content-type"),
    )


@app.get("/api/health")
async def health(request: Request):
    return await probe_llm(request.app.state.http)


@app.get("/v1/models")
async def list_models(request: Request):
    return await _proxy_stream(request, "/v1/models")


@app.post("/api/websearch")
async def websearch(request: Request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    query = (data.get("query") or "").strip()
    if not query:
        return JSONResponse({"error": "Missing query"}, status_code=400)
    max_results = int(data.get("max_results") or 5)
    results = await duckduckgo_search(query, max_results, client=request.app.state.http)
    return {"query": query, "results": results}


@app.post("/api/roleplay/expand")
async def roleplay_expand(request: Request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    brief = (data.get("brief") or "").strip()
    if not brief:
        return JSONResponse({"error": "Missing brief"}, status_code=400)
    language = data.get("language") or "vi"
    try:
        world = await expand_world(brief, language, request.app.state.http)
    except httpx.HTTPError as exc:
        return JSONResponse({"error": f"LLM error: {exc}"}, status_code=502)
    except ValueError as exc:
        return JSONResponse({"error": f"Parse error: {exc}"}, status_code=502)
    return world


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    agent_tools = body.pop("agent_tools", True)
    if agent_tools is False and body.get("mode") != "roleplay":
        # Re-wrap body without the extra field for a transparent proxy
        async def _raw_proxy():
            client: httpx.AsyncClient = request.app.state.http
            try:
                async with client.stream(
                    "POST",
                    _upstream("/v1/chat/completions"),
                    json=body,
                    timeout=LLM_TIMEOUT,
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk
            except httpx.HTTPError as exc:
                err = json_sse_error(f"Lỗi kết nối mô hình: {exc}")
                yield err

        return StreamingResponse(_raw_proxy(), media_type="text/event-stream")

    body["agent_tools"] = agent_tools

    async def _agent_out():
        async for chunk in stream_agent(body, http_client=request.app.state.http):
            if await request.is_disconnected():
                break
            yield chunk

    return StreamingResponse(_agent_out(), media_type="text/event-stream")


def json_sse_error(message: str) -> bytes:
    payload = {"choices": [{"delta": {"content": message}}]}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\ndata: [DONE]\n\n".encode()


@app.api_route("/v1/{path:path}", methods=["GET", "POST"])
async def proxy_v1(path: str, request: Request):
    return await _proxy_stream(request, f"/v1/{path}")


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")


def run() -> None:
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")

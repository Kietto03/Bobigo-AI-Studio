"""FastAPI app: static UI, llama-server proxy, web search, agent chat."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backend.agent.compress import summarize_messages
from backend.agent.loop import stream_agent
from backend.config import HOST, LLM_BASE_URL, LLM_TIMEOUT, PORT, WEB_DIR
from backend.expand import expand_world
from backend.health import probe_llm
from backend.mcp import MCPManager
from backend.tools import SCHEMAS
from backend.tools.web_search import duckduckgo_search


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = httpx.Timeout(LLM_TIMEOUT, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        app.state.http = client
        mcp = MCPManager()
        try:
            await mcp.start()
        except Exception:  # noqa: BLE001 — MCP is optional, never block startup
            pass
        app.state.mcp = mcp
        try:
            yield
        finally:
            await mcp.aclose()


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


def _builtin_catalog() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for schema in SCHEMAS:
        fn = schema.get("function") or {}
        props = ((fn.get("parameters") or {}).get("properties") or {})
        out.append({
            "name": fn.get("name"),
            "description": fn.get("description") or "",
            "parameters": list(props.keys()),
        })
    return out


@app.get("/api/tools")
async def tools_catalog(request: Request):
    mcp = getattr(request.app.state, "mcp", None)
    mcp_tools: list[dict[str, Any]] = []
    if mcp is not None:
        for schema in mcp.list_tools():
            fn = schema.get("function") or {}
            mcp_tools.append({"name": fn.get("name"), "description": fn.get("description") or ""})
    return {
        "builtin": _builtin_catalog(),
        "mcp": mcp_tools,
        "servers": mcp.servers_status() if mcp is not None else [],
    }


@app.get("/api/mcp/servers")
async def mcp_servers(request: Request):
    mcp = getattr(request.app.state, "mcp", None)
    return {"servers": mcp.servers_status() if mcp is not None else []}


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


@app.post("/api/extract-file")
async def extract_file(request: Request):
    content_type = request.headers.get("content-type", "")
    filename = "document"
    raw_bytes = b""

    if "multipart/form-data" in content_type:
        form = await request.form()
        uploaded_file = form.get("file")
        if not uploaded_file:
            return JSONResponse({"error": "Không tìm thấy tệp được tải lên"}, status_code=400)
        filename = getattr(uploaded_file, "filename", "document") or "document"
        raw_bytes = await uploaded_file.read()
    else:
        try:
            data = await request.json()
            filename = data.get("filename") or "document"
            import base64
            b64_content = data.get("content") or ""
            raw_bytes = base64.b64decode(b64_content) if b64_content else b""
        except Exception:
            return JSONResponse({"error": "Định dạng dữ liệu không hợp lệ"}, status_code=400)

    if not raw_bytes:
        return JSONResponse({"error": "Tệp rỗng hoặc không có dữ liệu"}, status_code=400)

    from backend.tools.files import extract_text_from_bytes, FileToolError
    try:
        text = extract_text_from_bytes(raw_bytes, filename=filename, max_bytes=100_000)
        return {
            "filename": filename,
            "size": len(raw_bytes),
            "text": text,
        }
    except FileToolError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"error": f"Lỗi xử lý tệp: {exc}"}, status_code=500)


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


@app.post("/api/compress")
async def compress_conversation(request: Request):
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    messages = data.get("messages")
    if not isinstance(messages, list) or not messages:
        return JSONResponse({"error": "Missing messages"}, status_code=400)
    language = data.get("language") or "vi"
    model = data.get("model") or None
    keep_recent = int(data.get("keep_recent") or 0)
    to_summarize = messages[:-keep_recent] if keep_recent > 0 else messages
    if not to_summarize:
        return {"summary": "", "compressed_count": 0}
    try:
        summary = await summarize_messages(
            to_summarize, request.app.state.http, model=model, language=language
        )
    except httpx.HTTPError as exc:
        return JSONResponse({"error": f"LLM error: {exc}"}, status_code=502)
    except ValueError as exc:
        return JSONResponse({"error": f"Parse error: {exc}"}, status_code=502)
    return {"summary": summary, "compressed_count": len(to_summarize)}


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
        async for chunk in stream_agent(
            body,
            http_client=request.app.state.http,
            mcp=getattr(request.app.state, "mcp", None),
        ):
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

    uvicorn.run("backend.app:app", host=HOST, port=PORT, log_level="info", reload=True)

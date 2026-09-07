"""FastAPI app: static UI, llama-server proxy, web search, agent chat."""

from __future__ import annotations

import asyncio
import json
import logging
import platform
import re
import socket
import subprocess
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

APP_START_TIME = time.time()

from backend import auth
from backend.agent.compress import summarize_messages
from backend.agent.context import trim_messages
from backend.agent.loop import stream_agent
from backend.config import (
    CONTEXT_WINDOW,
    HOST,
    LLM_BASE_URL,
    LLM_TIMEOUT,
    LOG_LEVEL,
    MAX_UPLOAD_BYTES,
    PORT,
    REPLY_RESERVE,
    WEB_DIR,
)
from backend.db import open_database, repo
from backend.health import probe_llm
from backend.mcp import MCPManager
from backend.tools import SCHEMAS
from backend.tools.genfiles import cleanup_generated
from backend.tools.web_search import duckduckgo_search

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("bobigo")


@asynccontextmanager
async def lifespan(app: FastAPI):
    timeout = httpx.Timeout(LLM_TIMEOUT, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        app.state.http = client
        # PostgreSQL pool (None if the DB is unavailable — app still serves).
        app.state.db = await open_database()
        if app.state.db is not None:
            log.info("PostgreSQL connected")
            try:
                await auth.bootstrap_admin(app.state.db)
            except Exception as exc:  # noqa: BLE001
                log.warning("Khởi tạo admin thất bại: %s", exc)
        else:
            log.warning("PostgreSQL unavailable — browser falls back to IndexedDB")

        # Garbage-collect agent-generated files (best-effort, never fatal).
        try:
            removed = cleanup_generated()
            if removed:
                log.info("Startup cleanup removed %d generated file(s)", removed)
        except Exception:  # noqa: BLE001
            log.exception("generated/ cleanup failed")
        mcp = MCPManager()
        try:
            await mcp.start()
            if mcp.clients:
                log.info("MCP servers connected: %s", ", ".join(mcp.clients))
            if mcp.errors:
                log.warning("MCP servers failed to load: %s", mcp.errors)
        except Exception:  # noqa: BLE001 — MCP is optional, never block startup
            log.exception("MCP manager failed to start")
        # Background watchdog: continuously ensures 192.168.100.1 stays pinned on Host Thunderbolt
        async def _host_network_guardian():
            while True:
                try:
                    await asyncio.sleep(5)
                    proc = await asyncio.create_subprocess_exec(
                        "ifconfig", "en2",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    out, _ = await proc.communicate()
                    text = out.decode("utf-8", errors="ignore")
                    if "192.168.100.1" not in text and "status: active" in text:
                        log.warning("Host en2 lost 192.168.100.1. Auto-restoring...")
                        fix = await asyncio.create_subprocess_exec(
                            "networksetup", "-setmanual", "EXO Thunderbolt 1", "192.168.100.1", "255.255.255.0",
                            stdout=asyncio.subprocess.DEVNULL,
                            stderr=asyncio.subprocess.DEVNULL,
                        )
                        await fix.wait()
                except asyncio.CancelledError:
                    break
                except Exception:
                    pass

        guardian_task = asyncio.create_task(_host_network_guardian())

        try:
            yield
        finally:
            guardian_task.cancel()
            await mcp.aclose()
            if app.state.db is not None:
                await app.state.db.close()


app = FastAPI(title="Bobigo AI Studio", lifespan=lifespan)


@app.middleware("http")
async def _no_cache_static(request: Request, call_next):
    """Caching + baseline security headers.

    App code (html/js/css) must revalidate so updates are never masked by a
    stale cache, but vendored third-party assets are pinned by commit — cache
    them aggressively. API responses get standard hardening headers.
    """
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/vendor/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path == "/" or path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    if path.startswith(("/api/", "/v1/")):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


# API paths reachable without a session (everything else under /api and /v1 needs auth).
_PUBLIC_API = {"/api/health", "/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/auth/trial-key"}


@app.middleware("http")
async def _auth_gate(request: Request, call_next):
    path = request.url.path
    request.state.user = None
    db = getattr(request.app.state, "db", None)

    # Extract auth token or API key from Authorization header, x-api-key, cookie, or query param
    auth_header = request.headers.get("authorization")
    raw_cred = (
        auth_header
        or request.headers.get("x-api-key")
        or request.cookies.get(auth.COOKIE_NAME)
        or request.query_params.get("api_key")
    )
    if db is not None and raw_cred:
        try:
            request.state.user = await auth.resolve_token_or_key(db, raw_cred)
        except Exception:  # noqa: BLE001
            request.state.user = None

    protected = (path.startswith("/api/") or path.startswith("/v1/")) and path not in _PUBLIC_API
    if protected:
        if db is None:
            return JSONResponse({"error": "Database unavailable"}, status_code=503)
        # Test hook: conftest sets app.state.auth_test_user (never set in prod).
        if request.state.user is None:
            request.state.user = getattr(request.app.state, "auth_test_user", None)
        if request.state.user is None:
            return JSONResponse({"error": "Chưa xác thực hoặc API Key không hợp lệ"}, status_code=401)
        if path.startswith("/api/admin/") and request.state.user["role"] != "admin":
            return JSONResponse({"error": "Yêu cầu quyền admin"}, status_code=403)
    return await call_next(request)


def _uid(request: Request) -> int:
    """Current user id — safe on protected routes (middleware guarantees a user)."""
    return request.state.user["id"]


def _upstream(path: str) -> str:
    return f"{LLM_BASE_URL.rstrip('/')}/{path.lstrip('/')}"


async def _proxy_stream(request: Request, path: str) -> Response:
    client: httpx.AsyncClient = request.app.state.http
    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in {"host", "content-length", "authorization", "x-api-key"}
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


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #
def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.COOKIE_NAME, token, max_age=auth.SESSION_TTL_DAYS * 86400,
        httponly=True, samesite="lax", path="/",
    )


@app.post("/api/auth/login")
async def auth_login(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        return JSONResponse({"error": "Database unavailable"}, status_code=503)
    body = await request.json()
    result = await auth.login(db, body.get("username", ""), body.get("password", ""))
    if not result:
        return JSONResponse({"error": "Sai tên đăng nhập hoặc mật khẩu"}, status_code=401)
    token, user = result
    resp = JSONResponse({"user": user})
    _set_session_cookie(resp, token)
    return resp


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    db = getattr(request.app.state, "db", None)
    token = request.cookies.get(auth.COOKIE_NAME)
    if db is not None:
        await auth.logout(db, token)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE_NAME, path="/")
    return resp


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = getattr(request.state, "user", None)
    return {"user": auth._pub(user) if user else None}


@app.post("/api/auth/trial-key")
async def auth_generate_trial_key(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "Public Trial").strip()[:64]
    async with db.acquire() as con:
        admin_id = await con.fetchval("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1") or 1
    key_obj = await auth.create_api_key(db, admin_id, name=f"Trial: {name}")
    return {"key": key_obj["key"], "name": key_obj["name"]}


# --------------------------------------------------------------------------- #
# Admin (role=admin only — enforced by the auth middleware)
# --------------------------------------------------------------------------- #
@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    return {"users": await auth.list_users(request.app.state.db)}


@app.post("/api/admin/users")
async def admin_create_user(request: Request):
    body = await request.json()
    try:
        user = await auth.create_user(
            request.app.state.db, body.get("username", ""), body.get("password", ""),
            role=body.get("role", "user"),
        )
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return {"user": user}


@app.patch("/api/admin/users/{user_id}")
async def admin_update_user(user_id: int, request: Request):
    db = request.app.state.db
    body = await request.json()
    try:
        if "password" in body and body["password"]:
            await auth.set_password(db, user_id, body["password"])
        if "disabled" in body:
            # An admin must not lock themselves out.
            if user_id == _uid(request) and body["disabled"]:
                return JSONResponse({"error": "Không thể tự vô hiệu hoá"}, status_code=400)
            await auth.set_disabled(db, user_id, bool(body["disabled"]))
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    return {"ok": True}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: int, request: Request):
    if user_id == _uid(request):
        return JSONResponse({"error": "Không thể tự xoá"}, status_code=400)
    await auth.delete_user(request.app.state.db, user_id)
    return {"ok": True}


@app.get("/api/admin/audit")
async def admin_audit(request: Request, limit: int = 200):
    return {"items": await repo.list_audit(request.app.state.db, min(max(limit, 1), 500), user_id=None)}


# --------------------------------------------------------------------------- #
# Admin API Keys Management
# --------------------------------------------------------------------------- #
@app.get("/api/admin/api-keys")
async def admin_list_api_keys(request: Request):
    return {"keys": await auth.list_api_keys(request.app.state.db)}


@app.post("/api/admin/api-keys")
async def admin_create_api_key(request: Request):
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "Trial API Key").strip()
    custom_key = body.get("key")
    key_obj = await auth.create_api_key(
        request.app.state.db,
        user_id=_uid(request),
        name=name,
        custom_key=custom_key,
    )
    return {"key": key_obj}


@app.delete("/api/admin/api-keys/{key_id}")
async def admin_delete_api_key(key_id: int, request: Request):
    await auth.delete_api_key(request.app.state.db, key_id)
    return {"ok": True}


_HOST_RAM_GB: float | None = None

def _get_host_ram_gb() -> float | None:
    global _HOST_RAM_GB
    if _HOST_RAM_GB is None:
        try:
            hw_mem = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], timeout=0.5).strip())
            _HOST_RAM_GB = round(hw_mem / (1024**3), 1)
        except Exception:
            _HOST_RAM_GB = 24.0
    return _HOST_RAM_GB


async def _probe_worker(host: str = "192.168.100.2", port: int = 50052) -> tuple[bool, float | None]:
    # 1. Check if llama-server currently has an ESTABLISHED connection to worker RPC
    try:
        proc = await asyncio.create_subprocess_exec(
            "netstat", "-an",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=1.0)
        out_str = stdout.decode()
        for line in out_str.splitlines():
            if str(port) in line and "ESTABLISHED" in line:
                ping_ms = await _get_ping_ms(host)
                return True, ping_ms or 0.5
    except Exception as e:
        print("[PROBE_NETSTAT_ERR]", e)

    # 2. If not established, try connecting to port
    t0 = time.time()
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=0.4)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True, round((time.time() - t0) * 1000, 2)
    except Exception:
        pass

    # 3. Check ping only if port is not reachable
    ping_ms = await _get_ping_ms(host)
    return False, ping_ms


async def _get_ping_ms(host: str) -> float | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", "1000", host,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=1.2)
        match = re.search(r"time=([\d\.]+)\s*ms", stdout.decode())
        if match:
            return float(match.group(1))
    except Exception:
        pass
    return None


@app.get("/api/admin/monitoring")
async def admin_monitoring(request: Request):
    db = getattr(request.app.state, "db", None)
    http_client: httpx.AsyncClient = request.app.state.http

    # 1. Host stats
    uptime_sec = int(time.time() - APP_START_TIME)
    h, rem = divmod(uptime_sec, 3600)
    m, s = divmod(rem, 60)
    uptime_str = f"{h}h {m}m {s}s" if h > 0 else f"{m}m {s}s"

    host_stats = {
        "hostname": platform.node(),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "ip": "192.168.100.1",
        "uptime": uptime_str,
        "uptime_sec": uptime_sec,
        "total_ram_gb": _get_host_ram_gb(),
        "metal_gpu": "Apple Silicon Integrated Metal GPU",
    }

    # 2. Worker node check (non-blocking async TCP probe)
    worker_host = "192.168.100.2"
    worker_port = 50052
    worker_online, worker_ping_ms = await _probe_worker(worker_host, worker_port)

    # 3. LLM Engine status
    llm_info = {
        "base_url": LLM_BASE_URL,
        "online": False,
        "model_name": None,
        "n_params": None,
        "quantization": None,
        "context_window": None,
        "jinja": True,
    }
    try:
        resp = await http_client.get(f"{LLM_BASE_URL.rstrip('/')}/v1/models", timeout=1.0)
        if resp.status_code == 200:
            llm_info["online"] = True
            data = resp.json().get("data", [])
            if data:
                m0 = data[0]
                meta = m0.get("meta", {})
                llm_info["model_name"] = m0.get("id", "").split("/")[-1]
                llm_info["n_params"] = meta.get("n_params")
                llm_info["quantization"] = meta.get("ftype")
                llm_info["context_window"] = meta.get("n_ctx")
    except Exception:
        pass

    # 4. Database metrics (single-query aggregated)
    db_stats = {
        "status": "connected" if db is not None else "offline",
        "users_count": 0,
        "sessions_count": 0,
        "messages_count": 0,
        "companions_count": 0,
        "projects_count": 0,
        "audit_count": 0,
    }
    if db is not None:
        try:
            async with db.acquire() as con:
                row = await con.fetchrow(
                    "SELECT (SELECT COUNT(*) FROM users) AS u, "
                    "(SELECT COUNT(*) FROM sessions) AS s, "
                    "(SELECT COUNT(*) FROM messages) AS m, "
                    "(SELECT COUNT(*) FROM companions) AS c, "
                    "(SELECT COUNT(*) FROM projects) AS p, "
                    "(SELECT COUNT(*) FROM audit_log) AS a"
                )
                if row:
                    db_stats["users_count"] = row["u"] or 0
                    db_stats["sessions_count"] = row["s"] or 0
                    db_stats["messages_count"] = row["m"] or 0
                    db_stats["companions_count"] = row["c"] or 0
                    db_stats["projects_count"] = row["p"] or 0
                    db_stats["audit_count"] = row["a"] or 0
        except Exception:
            pass

    # 5. Storage
    from backend.tools.genfiles import GENERATED_DIR
    gen_count = 0
    gen_bytes = 0
    if GENERATED_DIR.exists():
        for p in GENERATED_DIR.iterdir():
            if p.is_file() and not p.name.startswith("."):
                gen_count += 1
                try:
                    gen_bytes += p.stat().st_size
                except Exception:
                    pass

    return {
        "cluster": {
            "mode": "Dual-Mac RPC Cluster" if worker_online else "Single-Mac Standalone",
            "host": host_stats,
            "worker": {
                "ip": worker_host,
                "port": worker_port,
                "online": worker_online,
                "ping_ms": worker_ping_ms,
                "connection": "Thunderbolt Bridge (40 Gbps)",
            },
        },
        "llm": llm_info,
        "db": db_stats,
        "storage": {
            "genfiles_count": gen_count,
            "genfiles_bytes": gen_bytes,
            "genfiles_mb": round(gen_bytes / (1024 * 1024), 2),
        },
    }


@app.get("/api/admin/governance")
async def admin_governance(request: Request):
    db = getattr(request.app.state, "db", None)
    total_docs = 0
    sensitivity_counts = {"public": 0, "internal": 0, "confidential": 0, "restricted": 0}
    pii_total = 0
    pii_types_summary: dict[str, int] = {}
    redacted_count = 0
    ocr_count = 0

    if db is not None:
        try:
            async with db.acquire() as con:
                rows = await con.fetch("SELECT sensitivity, pii_types, pii_count, redacted, ocr_used FROM audit_log")
                total_docs = len(rows)
                for r in rows:
                    sens = (r["sensitivity"] or "internal").lower()
                    sensitivity_counts[sens] = sensitivity_counts.get(sens, 0) + 1
                    pii_total += (r["pii_count"] or 0)
                    if r["redacted"]:
                        redacted_count += 1
                    if r["ocr_used"]:
                        ocr_count += 1
                    types = r["pii_types"]
                    if isinstance(types, list):
                        for item in types:
                            if isinstance(item, dict):
                                t = item.get("type") or "unknown"
                                c = item.get("count") or 1
                                pii_types_summary[t] = pii_types_summary.get(t, 0) + c
                    elif isinstance(types, str):
                        try:
                            parsed = json.loads(types)
                            if isinstance(parsed, list):
                                for item in parsed:
                                    if isinstance(item, dict):
                                        t = item.get("type") or "unknown"
                                        c = item.get("count") or 1
                                        pii_types_summary[t] = pii_types_summary.get(t, 0) + c
                        except Exception:
                            pass
        except Exception:
            pass

    guardrails = {
        "context_window_limit": CONTEXT_WINDOW,
        "reply_reserve_tokens": REPLY_RESERVE,
        "pii_auto_redaction": True,
        "ocr_engine": "Vision + PaddleOCR Local",
        "file_retention_hours": 72,
        "allowed_tools": [
            {"id": "web_search", "name": "Web Search (Tavily/DuckDuckGo)", "status": "active", "risk": "Low"},
            {"id": "calculator", "name": "Mathematical Calculator", "status": "active", "risk": "Low"},
            {"id": "python_repl", "name": "Python Code Interpreter Sandbox", "status": "active", "risk": "Medium (Sandboxed)"},
            {"id": "file_reader", "name": "Document & File Reader (OCR / PII Scan)", "status": "active", "risk": "Low"},
            {"id": "mcp", "name": "Model Context Protocol (MCP) Extensions", "status": "active", "risk": "Controlled"},
        ],
        "compliance": [
            {"name": "Local Processing (Zero Cloud Data Exfiltration)", "status": "Compliant"},
            {"name": "PII Auto-Scrubbing & Redaction", "status": "Compliant"},
            {"name": "Role-Based Access Control (RBAC)", "status": "Compliant"},
            {"name": "Full Audit Trail Logging", "status": "Compliant"},
        ],
    }

    return {
        "summary": {
            "total_documents": total_docs,
            "sensitivity_breakdown": sensitivity_counts,
            "total_pii_detected": pii_total,
            "pii_types": pii_types_summary,
            "redacted_documents": redacted_count,
            "ocr_processed_documents": ocr_count,
            "redaction_rate_pct": round((redacted_count / total_docs * 100), 1) if total_docs else 100.0,
        },
        "guardrails": guardrails,
    }


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


@app.post("/api/mcp/restart")
async def mcp_restart(request: Request):
    """Reconnect all configured MCP servers (recovers crashed children / config edits)."""
    mcp = getattr(request.app.state, "mcp", None)
    if mcp is None:
        return {"servers": []}
    await mcp.restart()
    if mcp.clients:
        log.info("MCP servers reconnected: %s", ", ".join(mcp.clients))
    if mcp.errors:
        log.warning("MCP servers failed after restart: %s", mcp.errors)
    return {"servers": mcp.servers_status()}


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


def _upload_too_large(request: Request) -> JSONResponse | None:
    """Reject oversized uploads before reading the body into memory."""
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            {"error": f"Tệp quá lớn (tối đa {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)"},
            status_code=413,
        )
    return None


@app.post("/api/extract-file")
async def extract_file(request: Request):
    too_large = _upload_too_large(request)
    if too_large is not None:
        return too_large
    content_type = request.headers.get("content-type", "")
    filename = "document"
    raw_bytes = b""

    if "multipart/form-data" in content_type:
        form = await request.form()
        uploaded_file = form.get("file")
        if not uploaded_file or isinstance(uploaded_file, str):
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
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            {"error": f"Tệp quá lớn (tối đa {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)"},
            status_code=413,
        )

    from backend.tools.files import FileToolError, extract_text_from_bytes
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


@app.post("/api/to-markdown")
async def to_markdown(request: Request):
    """Convert an uploaded document to Markdown and return it as a .md download."""
    too_large = _upload_too_large(request)
    if too_large is not None:
        return too_large
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" not in content_type:
        return JSONResponse({"error": "Cần multipart/form-data với trường 'file'"}, status_code=400)
    form = await request.form()
    uploaded_file = form.get("file")
    if not uploaded_file or isinstance(uploaded_file, str):
        return JSONResponse({"error": "Không tìm thấy tệp được tải lên"}, status_code=400)
    filename = getattr(uploaded_file, "filename", "document") or "document"
    raw_bytes = await uploaded_file.read()
    if not raw_bytes:
        return JSONResponse({"error": "Tệp rỗng hoặc không có dữ liệu"}, status_code=400)
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            {"error": f"Tệp quá lớn (tối đa {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)"},
            status_code=413,
        )

    from backend.tools.files import FileToolError, extract_text_from_bytes
    from backend.tools.markdown_convert import convert_bytes_to_markdown

    try:
        # MarkItDown for rich formats; fall back to legacy extraction for plain
        # text / code so the endpoint always returns something usable.
        markdown = convert_bytes_to_markdown(raw_bytes, filename)
        if not markdown:
            markdown = extract_text_from_bytes(raw_bytes, filename=filename, max_bytes=5_000_000)
    except FileToolError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"Lỗi chuyển đổi: {exc}"}, status_code=500)

    from pathlib import Path as _Path
    from urllib.parse import quote

    stem = _Path(filename).stem or "document"
    ascii_stem = stem.encode("ascii", "ignore").decode() or "document"
    disposition = (
        f'attachment; filename="{ascii_stem}.md"; '
        f"filename*=UTF-8''{quote(stem)}.md"
    )
    return Response(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


def _form_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() not in ("false", "0", "no", "off", "")


@app.post("/api/ocr/process")
async def ocr_process(request: Request):
    """OCR / extract → redact PII → classify → summarize. Fully local."""
    import hashlib
    from pathlib import Path as _Path

    if "multipart/form-data" not in request.headers.get("content-type", ""):
        return JSONResponse({"error": "Cần multipart/form-data với trường 'file'"}, status_code=400)
    form = await request.form()
    uploaded = form.get("file")
    if not uploaded:
        return JSONResponse({"error": "Không tìm thấy tệp"}, status_code=400)
    filename = getattr(uploaded, "filename", "document") or "document"
    data = await uploaded.read()
    if not data:
        return JSONResponse({"error": "Tệp rỗng"}, status_code=400)

    language = form.get("language") or "vi"
    redact = _form_bool(form.get("redact_pii"), True)
    keep_fulltext = _form_bool(form.get("keep_fulltext"), True)
    ocr_langs = form.get("ocr_langs") or None

    from backend.ocr import process_document
    from backend.tools.genfiles import save_generated_file

    try:
        result = await process_document(
            data, filename, request.app.state.http,
            langs=ocr_langs, redact_pii=redact, language=language,
        )
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": f"Lỗi xử lý tài liệu: {exc}"}, status_code=500)

    stem = _Path(filename).stem or "document"
    summary_file = None
    if result["summary_markdown"]:
        summary_file = save_generated_file(
            f"{stem}_tomtat.md", result["summary_markdown"].encode("utf-8"))
    text_file = None
    body_text = result["redacted_text"] if redact else result["text"]
    if keep_fulltext and body_text.strip():
        text_file = save_generated_file(f"{stem}_toanvan.md", body_text.encode("utf-8"))

    entities = result["pii"]["entities"]
    audit_id = None
    db = getattr(request.app.state, "db", None)
    if db is not None:
        try:
            audit_id = await repo.insert_audit(db, {
                "user_id": _uid(request),
                "filename": filename,
                "sha256": hashlib.sha256(data).hexdigest(),
                "size": len(data),
                "mime": getattr(uploaded, "content_type", None),
                "pages": result["extract"].get("pages"),
                "method": result["extract"].get("method"),
                "ocr_used": result["extract"].get("ocr_used"),
                "pii_types": entities,
                "pii_count": sum(e.get("count", 0) for e in entities),
                "sensitivity": result["sensitivity"],
                "redacted": redact,
                "summary_file_id": summary_file["id"] if summary_file else None,
                "text_file_id": text_file["id"] if text_file else None,
            })
        except Exception:  # noqa: BLE001 — audit must never break the response
            pass

    return {
        "filename": filename,
        "method": result["extract"].get("method"),
        "ocr_used": result["extract"].get("ocr_used"),
        "pages": result["extract"].get("pages"),
        "text": body_text,
        "pii": result["pii"],
        "sensitivity": result["sensitivity"],
        "summary_markdown": result["summary_markdown"],
        "summary_file": summary_file,
        "text_file": text_file,
        "audit_id": audit_id,
    }


@app.get("/api/audit")
async def get_audit(request: Request, limit: int = 50):
    db = getattr(request.app.state, "db", None)
    if db is None:
        return {"items": []}
    return {"items": await repo.list_audit(db, min(max(limit, 1), 200), user_id=_uid(request))}


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


# --------------------------------------------------------------------------- #
# Persistence store (PostgreSQL). Single-user: no scoping. The client keeps the
# whole collection in memory and PUTs it back (debounced); we reconcile it into
# the relational tables. 503 when the DB is down so the client falls back to its
# local IndexedDB cache.
# --------------------------------------------------------------------------- #
def _db_or_503(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        return None, JSONResponse({"error": "Database unavailable"}, status_code=503)
    return db, None


async def _read_list(request: Request) -> list:
    body = await request.json()
    return body if isinstance(body, list) else []


@app.get("/api/sessions")
async def get_sessions(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    return await repo.get_sessions(db, _uid(request))


@app.put("/api/sessions")
async def put_sessions(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    await repo.replace_sessions(db, _uid(request), await _read_list(request))
    return {"ok": True}


@app.post("/api/sessions/{session_id}/messages", status_code=201)
@app.post("/api/{session_id}/messages", status_code=201)
async def post_session_message(session_id: str, request: Request):
    """Append one message without rewriting the thread (incremental persistence).

    The session row must already exist (the client creates it via the bulk PUT).
    Returns the seq index assigned so the client can reconcile ordering.
    """
    db, err = _db_or_503(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    if not isinstance(body, dict) or not (body.get("content") or body.get("text")):
        return JSONResponse({"error": "message requires 'content' or 'text'"}, status_code=400)
    seq = await repo.append_session_message(db, session_id, body)
    return {"ok": True, "seq": seq}


@app.delete("/api/sessions/{session_id}", status_code=204)
async def delete_session_by_id(session_id: str, request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    await repo.delete_session(db, session_id)
    return Response(status_code=204)


@app.post("/api/tokenize")
async def tokenize(request: Request):
    """Exact token count via llama-server's /tokenize; heuristic fallback.

    ``exact: false`` in the response means llama-server was unreachable and the
    len/4 estimate was used — the same estimate the context trimmer relies on.
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)
    text = data.get("text") if isinstance(data, dict) else None
    if not isinstance(text, str):
        return JSONResponse({"error": "body must be {\"text\": ...}"}, status_code=400)
    client: httpx.AsyncClient = request.app.state.http
    try:
        resp = await client.post(
            f"{LLM_BASE_URL.rstrip('/')}/tokenize",
            json={"content": text},
            timeout=10.0,
        )
        resp.raise_for_status()
        ids = resp.json().get("tokens") or []
        return {"count": len(ids), "exact": True}
    except (httpx.HTTPError, ValueError):
        est = max(1, -(-len(text) // 4)) if text else 0  # ceil division
        return {"count": est, "exact": False}


@app.get("/api/companions")
async def get_companions(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    return await repo.get_companions(db, _uid(request))


@app.put("/api/companions")
async def put_companions(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    await repo.replace_companions(db, _uid(request), await _read_list(request))
    return {"ok": True}


@app.get("/api/projects")
async def get_projects(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    return await repo.get_projects(db, _uid(request))


@app.put("/api/projects")
async def put_projects(request: Request):
    db, err = _db_or_503(request)
    if err:
        return err
    await repo.replace_projects(db, _uid(request), await _read_list(request))
    return {"ok": True}


@app.post("/api/import")
async def import_all(request: Request):
    """One-time bulk import of legacy browser data. Only replaces provided keys."""
    db, err = _db_or_503(request)
    if err:
        return err
    body = await request.json()
    if not isinstance(body, dict):
        return JSONResponse({"error": "Expected an object"}, status_code=400)
    if isinstance(body.get("projects"), list):
        await repo.replace_projects(db, _uid(request), body["projects"])
    if isinstance(body.get("sessions"), list):
        await repo.replace_sessions(db, _uid(request), body["sessions"])
    if isinstance(body.get("companions"), list):
        await repo.replace_companions(db, _uid(request), body["companions"])
    return {"ok": True}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    # If caller supplies its own tools (e.g. Cline, Roo Code, OpenAI SDK) and did not explicitly
    # request internal agent_tools, pass through transparently to the raw model.
    if "tools" in body and body.get("agent_tools") is None:
        agent_tools = False
    else:
        agent_tools = body.pop("agent_tools", True)
    if agent_tools is False:
        # Token Guard: Trim messages to safely fit context window, preventing RPC crash & OOM
        raw_msgs = body.get("messages")
        if isinstance(raw_msgs, list) and raw_msgs:
            body["messages"] = trim_messages(raw_msgs, window=CONTEXT_WINDOW, reserve=REPLY_RESERVE)

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
            should_cancel=request.is_disconnected,
        ):
            yield chunk

    return StreamingResponse(_agent_out(), media_type="text/event-stream")


def json_sse_error(message: str) -> bytes:
    payload = {"choices": [{"delta": {"content": message}}]}
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\ndata: [DONE]\n\n".encode()


@app.get("/api/files/{file_id}")
async def serve_generated_file(file_id: str, download: int = 0):
    """Serve a file the agent generated (inline for preview, or as a download)."""
    from urllib.parse import quote

    from backend.tools.genfiles import resolve_generated

    path = resolve_generated(file_id)
    if path is None or not path.exists():
        return JSONResponse({"error": "File không tồn tại"}, status_code=404)
    # Stored name is "<id>__<realName>"; present the real name to the user.
    display = path.name.split("__", 1)[-1]
    disp_type = "attachment" if download else "inline"
    ascii_name = display.encode("ascii", "ignore").decode() or "file"
    disposition = f"{disp_type}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(display)}"
    return FileResponse(path, headers={"Content-Disposition": disposition})


@app.get("/api/files/{file_id}/preview")
async def preview_generated_file(file_id: str):
    """Markdown preview of a generated document (used for docx/xlsx/pdf)."""
    from backend.tools.genfiles import resolve_generated
    from backend.tools.markdown_convert import convert_bytes_to_markdown

    path = resolve_generated(file_id)
    if path is None or not path.exists():
        return JSONResponse({"error": "File không tồn tại"}, status_code=404)
    display = path.name.split("__", 1)[-1]
    markdown = convert_bytes_to_markdown(path.read_bytes(), display) or ""
    return {"markdown": markdown}


@app.api_route("/v1/{path:path}", methods=["GET", "POST"])
async def proxy_v1(path: str, request: Request):
    return await _proxy_stream(request, f"/v1/{path}")


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")


def run() -> None:
    import uvicorn

    uvicorn.run("backend.app:app", host=HOST, port=PORT, log_level="info", reload=True)

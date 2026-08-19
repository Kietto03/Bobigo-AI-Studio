"""Agent tool registry and OpenAI-compatible schemas."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable

import httpx

from backend.config import MAX_SEARCH_RESULTS
from backend.tools.calculator import CalculatorError, calculate
from backend.tools.code_interpreter import CodeInterpreterError, run_python
from backend.tools.files import FileToolError, list_workspace_files, read_workspace_file
from backend.tools.url_reader import UrlReaderError, read_url
from backend.tools.web_search import duckduckgo_search, format_search_results

ToolHandler = Callable[[dict[str, Any], httpx.AsyncClient | None], Awaitable[str]]


SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Tìm kiếm thông tin trên Internet qua DuckDuckGo. Dùng khi cần dữ liệu thời sự hoặc sự thật mới.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Từ khóa tìm kiếm"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Tính biểu thức toán học chính xác (cộng trừ nhân chia, lũy thừa, căn, lượng giác, log).",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "Biểu thức, ví dụ: 2**10 + sqrt(16)"},
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "code_interpreter",
            "description": "Chạy một đoạn Python ngắn (không mạng, không file, không subprocess) và trả về stdout.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Mã Python cần chạy"},
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "url_reader",
            "description": "Tải nội dung văn bản của một trang http/https công khai.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL đầy đủ, bắt đầu bằng http hoặc https"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "Liệt kê file/thư mục trong workspace dự án Bobigo (tương đối từ gốc repo).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Thư mục tương đối, mặc định '.'"},
                    "pattern": {"type": "string", "description": "Glob, ví dụ '*.py' hoặc '*'"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Đọc một file text trong workspace (không đọc .env, khóa, hay file ngoài repo).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Đường dẫn tương đối, ví dụ backend/config.py"},
                },
                "required": ["path"],
            },
        },
    },
]


async def _web_search(args: dict[str, Any], client: httpx.AsyncClient | None) -> str:
    results = await duckduckgo_search(
        str(args.get("query", "")),
        max_results=MAX_SEARCH_RESULTS,
        client=client,
    )
    return format_search_results(results)


async def _calculator(args: dict[str, Any], client: httpx.AsyncClient | None) -> str:
    del client
    return calculate(str(args.get("expression", "")))


async def _code_interpreter(args: dict[str, Any], client: httpx.AsyncClient | None) -> str:
    del client
    # run_python spawns a subprocess and blocks up to CODE_EXEC_TIMEOUT seconds;
    # keep it off the event loop so other streams are not frozen.
    return await asyncio.to_thread(run_python, str(args.get("code", "")))


async def _url_reader(args: dict[str, Any], client: httpx.AsyncClient | None) -> str:
    return await read_url(str(args.get("url", "")), client=client)


async def _list_files(args: dict[str, Any], client: httpx.AsyncClient | None) -> str:
    del client
    return await asyncio.to_thread(
        list_workspace_files, str(args.get("path") or "."), str(args.get("pattern") or "*")
    )


async def _read_file(args: dict[str, Any], client: httpx.AsyncClient | None) -> str:
    del client
    return await asyncio.to_thread(read_workspace_file, str(args.get("path", "")))


_HANDLERS: dict[str, ToolHandler] = {
    "web_search": _web_search,
    "calculator": _calculator,
    "code_interpreter": _code_interpreter,
    "url_reader": _url_reader,
    "list_files": _list_files,
    "read_file": _read_file,
}


def tool_schemas(mcp: Any = None) -> list[dict[str, Any]]:
    if mcp is not None:
        try:
            return SCHEMAS + mcp.list_tools()
        except Exception:  # noqa: BLE001 — never let MCP break the built-ins
            return SCHEMAS
    return SCHEMAS


def known_tool_names() -> set[str]:
    return set(_HANDLERS)


async def execute_tool(
    name: str,
    arguments: dict[str, Any] | str | None,
    client: httpx.AsyncClient | None = None,
    mcp: Any = None,
) -> str:
    if mcp is not None and getattr(mcp, "is_mcp_tool", None) and mcp.is_mcp_tool(name):
        parsed_mcp = arguments
        if isinstance(arguments, str):
            try:
                parsed_mcp = json.loads(arguments.strip() or "{}")
            except json.JSONDecodeError:
                parsed_mcp = {}
        elif not isinstance(arguments, dict):
            parsed_mcp = {}
        return await mcp.call(name, parsed_mcp)

    handler = _HANDLERS.get(name)
    if handler is None:
        return f"Lỗi: không có tool '{name}'"
    if isinstance(arguments, str):
        raw = arguments.strip() or "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return f"Lỗi: arguments không phải JSON hợp lệ: {raw[:300]}"
    elif arguments is None:
        parsed = {}
    elif isinstance(arguments, dict):
        parsed = arguments
    else:
        return "Lỗi: arguments sai kiểu"
    try:
        return await handler(parsed, client)
    except (CalculatorError, CodeInterpreterError, UrlReaderError, FileToolError) as exc:
        return f"Lỗi {name}: {exc}"
    except Exception as exc:
        return f"Lỗi {name}: {exc}"

"""Minimal MCP client speaking JSON-RPC 2.0 over a stdio subprocess.

MCP stdio framing is newline-delimited JSON (one message per line). We only
need the client→server calls the agent uses: initialize, tools/list, tools/call.
Server-initiated requests/notifications are ignored.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

PROTOCOL_VERSION = "2024-11-05"


class MCPError(RuntimeError):
    pass


class StdioMCPClient:
    def __init__(
        self,
        name: str,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        *,
        timeout: float = 30.0,
    ) -> None:
        self.name = name
        self.command = command
        self.args = list(args or [])
        self.env = dict(env or {})
        self.timeout = timeout
        self.proc: asyncio.subprocess.Process | None = None
        self.tools: list[dict[str, Any]] = []
        self._id = 0
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self.proc = await asyncio.create_subprocess_exec(
            self.command,
            *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={**os.environ, **self.env},
        )
        await self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "bobigo", "version": "1.0"},
            },
        )
        await self._notify("notifications/initialized")
        result = await self._request("tools/list", {})
        self.tools = list((result or {}).get("tools") or [])

    async def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> str:
        result = await self._request(
            "tools/call", {"name": tool_name, "arguments": arguments or {}}
        )
        return _content_to_text(result)

    async def aclose(self) -> None:
        if not self.proc:
            return
        try:
            if self.proc.returncode is None:
                self.proc.terminate()
                try:
                    await asyncio.wait_for(self.proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    self.proc.kill()
        except ProcessLookupError:
            pass
        finally:
            self.proc = None

    # -- JSON-RPC plumbing --------------------------------------------------

    async def _write(self, message: dict[str, Any]) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write((json.dumps(message) + "\n").encode("utf-8"))
        await self.proc.stdin.drain()

    async def _notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        await self._write(msg)

    async def _request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        if not self.proc or not self.proc.stdout:
            raise MCPError(f"MCP server '{self.name}' is not running")
        async with self._lock:
            self._id += 1
            req_id = self._id
            msg: dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
            if params is not None:
                msg["params"] = params
            await self._write(msg)
            while True:
                line = await asyncio.wait_for(self.proc.stdout.readline(), self.timeout)
                if not line:
                    raise MCPError(f"MCP server '{self.name}' closed the connection")
                try:
                    obj = json.loads(line.decode("utf-8").strip())
                except json.JSONDecodeError:
                    continue
                if obj.get("id") != req_id:
                    continue  # notification or unrelated response
                if "error" in obj:
                    raise MCPError(str(obj["error"]))
                return obj.get("result")


def _content_to_text(result: Any) -> str:
    """Flatten an MCP tools/call result into plain text for the model."""
    if not isinstance(result, dict):
        return str(result)
    parts: list[str] = []
    for block in result.get("content") or []:
        if isinstance(block, dict):
            if block.get("type") == "text":
                parts.append(str(block.get("text") or ""))
            elif block.get("text"):
                parts.append(str(block["text"]))
    text = "\n".join(p for p in parts if p)
    if result.get("isError"):
        return f"[tool error] {text}" if text else "[tool error]"
    return text or "(no output)"

"""Load MCP servers from mcp.json, connect them, and expose their tools.

The tool names given to the model are namespaced ``mcp_<server>_<tool>`` so they
never collide with the built-in tools, and mapped back on call.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any

from backend.config import BASE_DIR
from backend.mcp.client import MCPError, StdioMCPClient

MCP_CONFIG_PATH = os.path.join(BASE_DIR, "mcp.json")
_SANITIZE_RE = re.compile(r"[^a-zA-Z0-9_-]+")

log = logging.getLogger(__name__)


def _sanitize(part: str) -> str:
    return _SANITIZE_RE.sub("_", part).strip("_") or "x"


def namespaced_name(server: str, tool: str) -> str:
    return f"mcp_{_sanitize(server)}_{_sanitize(tool)}"[:64]


def load_config(path: str = MCP_CONFIG_PATH) -> dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    return servers if isinstance(servers, dict) else {}


class MCPManager:
    def __init__(self) -> None:
        self.clients: dict[str, StdioMCPClient] = {}
        self.errors: dict[str, str] = {}
        # namespaced tool name -> (server, original tool name, schema)
        self._routes: dict[str, tuple[str, str, dict[str, Any]]] = {}

    async def start(self, config: dict[str, Any] | None = None) -> None:
        servers = config if config is not None else load_config()
        for name, spec in servers.items():
            if not isinstance(spec, dict):
                continue
            command = spec.get("command")
            if not command:
                self.errors[name] = "missing 'command' (only stdio servers are supported)"
                continue
            client = StdioMCPClient(
                name,
                command,
                spec.get("args") or [],
                spec.get("env") or {},
            )
            try:
                await client.start()
            except (MCPError, OSError, asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
                self.errors[name] = str(exc)
                await client.aclose()
                continue
            self.clients[name] = client
            for tool in client.tools:
                tname = tool.get("name")
                if not tname:
                    continue
                ns = namespaced_name(name, tname)
                self._routes[ns] = (name, tname, tool)

    def has_servers(self) -> bool:
        return bool(self.clients) or bool(self.errors)

    async def restart(self, config: dict[str, Any] | None = None) -> None:
        """Stop every child process and start again from mcp.json.

        Used by POST /api/mcp/restart so a crashed stdio server (or an edited
        config) can be recovered without restarting the whole backend.
        """
        await self.aclose()
        self.errors.clear()
        await self.start(config)

    def list_tools(self) -> list[dict[str, Any]]:
        """Return OpenAI-compatible function schemas for all MCP tools."""
        schemas: list[dict[str, Any]] = []
        for ns, (server, _tool, spec) in self._routes.items():
            schemas.append({
                "type": "function",
                "function": {
                    "name": ns,
                    "description": f"[MCP:{server}] {spec.get('description') or spec.get('name') or ns}",
                    "parameters": spec.get("inputSchema") or {"type": "object", "properties": {}},
                },
            })
        return schemas

    def is_mcp_tool(self, name: str) -> bool:
        return name in self._routes

    async def _try_revive(self, server: str) -> None:
        """Restart a single configured server (stale pipe / crashed child)."""
        cfg = load_config().get(server)
        if not isinstance(cfg, dict) or not cfg.get("command"):
            return
        log.info("Reviving MCP server '%s'", server)
        old = self.clients.pop(server, None)
        if old is not None:
            try:
                await old.aclose()
            except Exception:  # noqa: BLE001 — best-effort teardown
                pass
            self._routes = {k: v for k, v in self._routes.items() if v[0] != server}
        client = StdioMCPClient(
            server, cfg["command"], cfg.get("args") or [], cfg.get("env") or {}
        )
        try:
            await client.start()
        except Exception as exc:  # noqa: BLE001
            self.errors[server] = str(exc)
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass
            return
        self.errors.pop(server, None)
        self.clients[server] = client
        for tool in client.tools:
            tname = tool.get("name")
            if tname:
                self._routes[namespaced_name(server, tname)] = (server, tname, tool)

    async def call(self, name: str, arguments: dict[str, Any]) -> str:
        route = self._routes.get(name)
        if not route:
            return f"Lỗi: không có MCP tool '{name}'"
        server, tool_name, _spec = route
        client = self.clients.get(server)
        if not client:
            await self._try_revive(server)
            client = self.clients.get(server)
        if not client:
            return f"Lỗi: MCP server '{server}' không sẵn sàng"
        try:
            return await client.call_tool(tool_name, arguments or {})
        except Exception as exc:  # noqa: BLE001
            # Dead pipe? Revive that one server and retry once.
            await self._try_revive(server)
            retry_client = self.clients.get(server)
            if retry_client is not None:
                try:
                    return await retry_client.call_tool(tool_name, arguments or {})
                except Exception as exc2:  # noqa: BLE001
                    return f"Lỗi MCP {name}: {exc2}"
            return f"Lỗi MCP {name}: {exc}"

    def servers_status(self) -> list[dict[str, Any]]:
        status: list[dict[str, Any]] = []
        for name, client in self.clients.items():
            status.append({
                "name": name,
                "connected": True,
                "tools": [
                    {"name": t.get("name"), "description": t.get("description") or ""}
                    for t in client.tools
                ],
            })
        for name, err in self.errors.items():
            status.append({"name": name, "connected": False, "error": err, "tools": []})
        return status

    async def aclose(self) -> None:
        for client in self.clients.values():
            await client.aclose()
        self.clients.clear()
        self._routes.clear()

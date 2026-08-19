"""Lightweight Model Context Protocol (MCP) client.

Connects to user-configured MCP servers over stdio (JSON-RPC 2.0) and exposes
their tools to the agent loop. Opt-in: with no ``mcp.json`` the manager is empty
and has zero effect on the app.
"""

from backend.mcp.manager import MCPManager

__all__ = ["MCPManager"]

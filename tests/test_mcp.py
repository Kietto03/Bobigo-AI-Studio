import asyncio
import os
import sys

from fastapi.testclient import TestClient

from backend.app import app
from backend.mcp.manager import MCPManager, namespaced_name
from backend.tools import execute_tool, tool_schemas

ECHO_SERVER = os.path.join(os.path.dirname(__file__), "mcp_echo_server.py")
ECHO_CONFIG = {"echo": {"command": sys.executable, "args": [ECHO_SERVER]}}


def test_namespaced_name_sanitizes():
    assert namespaced_name("My Server", "read-file") == "mcp_My_Server_read-file"


def test_manager_connects_and_lists_tools():
    async def run():
        mgr = MCPManager()
        await mgr.start(ECHO_CONFIG)
        try:
            schemas = mgr.list_tools()
            names = [s["function"]["name"] for s in schemas]
            assert "mcp_echo_echo" in names
            assert mgr.is_mcp_tool("mcp_echo_echo")
            status = mgr.servers_status()
            assert status[0]["connected"] is True
            return await mgr.call("mcp_echo_echo", {"text": "xin chào"})
        finally:
            await mgr.aclose()

    assert asyncio.run(run()) == "xin chào"


def test_execute_tool_routes_to_mcp():
    async def run():
        mgr = MCPManager()
        await mgr.start(ECHO_CONFIG)
        try:
            # tool_schemas merges built-ins + MCP
            names = [s["function"]["name"] for s in tool_schemas(mgr)]
            assert "web_search" in names and "mcp_echo_echo" in names
            # execute_tool routes namespaced calls to the manager
            return await execute_tool("mcp_echo_echo", {"text": "hi"}, None, mgr)
        finally:
            await mgr.aclose()

    assert asyncio.run(run()) == "hi"


def test_manager_bad_server_is_isolated():
    async def run():
        mgr = MCPManager()
        await mgr.start({"broken": {"command": "definitely-not-a-real-binary-xyz"}})
        try:
            assert mgr.list_tools() == []
            status = mgr.servers_status()
            assert status and status[0]["connected"] is False
        finally:
            await mgr.aclose()

    asyncio.run(run())


def test_tools_endpoint_lists_builtins():
    with TestClient(app) as c:
        data = c.get("/api/tools").json()
        names = [t["name"] for t in data["builtin"]]
        assert "web_search" in names and "code_interpreter" in names
        assert "servers" in data

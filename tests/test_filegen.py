"""Tests for the file-generation tools + serving endpoints."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.tools import execute_tool
from backend.tools.genfiles import extract_file_markers, resolve_generated


def _gen(tool, args):
    result = asyncio.run(execute_tool(tool, args))
    clean, files = extract_file_markers(result)
    return clean, files


def test_create_file_writes_and_registers():
    clean, files = _gen("create_file", {"filename": "note.md", "content": "# Hi\n\n- a\n- b"})
    assert "note.md" in clean
    assert "\x1f" not in clean  # marker stripped from human text
    assert len(files) == 1
    meta = files[0]
    assert meta["name"] == "note.md" and meta["kind"] == "markdown" and meta["size"] > 0
    assert resolve_generated(meta["id"]) is not None


def test_create_file_rejects_binary_extension():
    result = asyncio.run(execute_tool("create_file", {"filename": "x.exe", "content": "bad"}))
    assert "không được phép" in result or "Lỗi" in result


def test_create_docx_and_xlsx():
    _, docx_files = _gen("create_docx", {"filename": "r.docx", "content": "# T\n- x\npara"})
    assert docx_files and docx_files[0]["kind"] == "docx"
    _, xlsx_files = _gen("create_xlsx", {"filename": "d.xlsx", "content": "A,B\n1,2"})
    assert xlsx_files and xlsx_files[0]["kind"] == "xlsx"


def test_serve_generated_file_inline_and_download():
    _, files = _gen("create_file", {"filename": "hello.txt", "content": "xin chào"})
    fid = files[0]["id"]
    with TestClient(app) as client:
        r = client.get(f"/api/files/{fid}")
        assert r.status_code == 200
        assert "xin chào" in r.text
        assert r.headers["content-disposition"].startswith("inline")
        r2 = client.get(f"/api/files/{fid}?download=1")
        assert r2.headers["content-disposition"].startswith("attachment")
        assert client.get("/api/files/doesnotexist9/").status_code == 404


def test_preview_endpoint_converts_xlsx():
    try:
        import markitdown  # noqa: F401
    except Exception:
        pytest.skip("markitdown not installed")
    _, files = _gen("create_xlsx", {"filename": "sales.xlsx", "content": "Q,Rev\nQ1,100\nQ2,150"})
    fid = files[0]["id"]
    with TestClient(app) as client:
        r = client.get(f"/api/files/{fid}/preview")
        assert r.status_code == 200
        md = r.json()["markdown"]
        assert "Q1" in md and "|" in md  # rendered as a markdown table


def test_tools_catalog_includes_generation_tools():
    with TestClient(app) as client:
        names = [t["name"] for t in client.get("/api/tools").json()["builtin"]]
        assert {"create_file", "create_docx", "create_xlsx"} <= set(names)

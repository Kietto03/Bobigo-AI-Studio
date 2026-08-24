import pytest
from fastapi.testclient import TestClient

from backend.app import app


def _markitdown_or_skip():
    try:
        import markitdown  # noqa: F401
    except Exception:
        pytest.skip("markitdown not installed")


def test_index_served():
    with TestClient(app) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "Bobigo" in resp.text


def test_websearch_requires_query():
    with TestClient(app) as client:
        resp = client.post("/api/websearch", json={})
        assert resp.status_code == 400


def test_chat_returns_sse_when_llm_down():
    with TestClient(app) as client:
        resp = client.post(
            "/v1/chat/completions",
            json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
        )
        assert resp.status_code == 200
        assert "data:" in resp.text
        assert "[DONE]" in resp.text


def test_extract_file_multipart():
    with TestClient(app) as client:
        files = {"file": ("test.txt", b"Hello from multipart upload!", "text/plain")}
        resp = client.post("/api/extract-file", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["filename"] == "test.txt"
        assert "Hello from multipart upload!" in data["text"]


def test_extract_file_empty_fails():
    with TestClient(app) as client:
        resp = client.post("/api/extract-file", json={})
        assert resp.status_code == 400


def test_extract_file_html_becomes_markdown():
    _markitdown_or_skip()
    html = b"<h1>Title</h1><p>hello <b>bold</b></p><ul><li>a</li><li>b</li></ul>"
    with TestClient(app) as client:
        resp = client.post("/api/extract-file", files={"file": ("doc.html", html, "text/html")})
        assert resp.status_code == 200
        text = resp.json()["text"]
        assert "# Title" in text
        assert "**bold**" in text
        assert "* a" in text


def test_extract_file_plain_text_unchanged():
    with TestClient(app) as client:
        resp = client.post("/api/extract-file", files={"file": ("n.txt", b"line1\nline2", "text/plain")})
        assert resp.status_code == 200
        assert resp.json()["text"] == "line1\nline2"


def test_to_markdown_returns_md_download():
    _markitdown_or_skip()
    with TestClient(app) as client:
        resp = client.post("/api/to-markdown", files={"file": ("d.html", b"<h1>Xin chao</h1>", "text/html")})
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/markdown")
        disp = resp.headers["content-disposition"]
        assert "attachment" in disp and ".md" in disp
        assert "# Xin chao" in resp.text


def test_to_markdown_requires_file():
    with TestClient(app) as client:
        resp = client.post("/api/to-markdown", json={})
        assert resp.status_code == 400


def test_tools_catalog_includes_convert_to_markdown():
    with TestClient(app) as client:
        resp = client.get("/api/tools")
        assert resp.status_code == 200
        names = [t["name"] for t in resp.json().get("builtin", [])]
        assert "convert_to_markdown" in names

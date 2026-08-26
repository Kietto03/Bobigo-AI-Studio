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


def test_upload_size_guard():
    """Server-side cap rejects oversized uploads before reading the body."""
    from types import SimpleNamespace

    import backend.config as cfg
    from backend.app import _upload_too_large

    over = _upload_too_large(
        SimpleNamespace(headers={"content-length": str(cfg.MAX_UPLOAD_BYTES + 1)})
    )
    assert over is not None
    assert over.status_code == 413

    # Missing or within-limit Content-Length passes through.
    assert _upload_too_large(SimpleNamespace(headers={})) is None
    assert (
        _upload_too_large(SimpleNamespace(headers={"content-length": "1024"})) is None
    )


def test_tokenize_falls_back_to_heuristic_when_llm_down():
    """Without llama-server, /api/tokenize returns a len/4 estimate (exact=False)."""
    with TestClient(app) as client:
        resp = client.post("/api/tokenize", json={"text": "xin chào thế giới"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["exact"] is False
        assert data["count"] >= 1


def test_tokenize_empty_text_counts_zero():
    with TestClient(app) as client:
        data = client.post("/api/tokenize", json={"text": ""}).json()
        assert data == {"count": 0, "exact": False}


def test_tokenize_requires_text_field():
    with TestClient(app) as client:
        assert client.post("/api/tokenize", json={}).status_code == 400
        assert client.post("/api/tokenize", json={"text": 42}).status_code == 400


def test_api_security_headers_present():
    with TestClient(app) as client:
        r = client.get("/api/tools")
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("x-frame-options") == "SAMEORIGIN"
        assert r.headers.get("referrer-policy") == "no-referrer"


def test_vendor_assets_cache_immutable_app_code_revalidates():
    with TestClient(app) as client:
        vendor = client.get("/vendor/marked.min.js")
        assert vendor.status_code == 200
        assert "immutable" in (vendor.headers.get("cache-control") or "")

        shell = client.head("/")
        assert shell.status_code == 200
        assert "no-cache" in (shell.headers.get("cache-control") or "")

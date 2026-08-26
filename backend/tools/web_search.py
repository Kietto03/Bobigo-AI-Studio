"""DuckDuckGo HTML search used by both the agent tool and /api/websearch."""

from __future__ import annotations

import asyncio
import html
import re
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from backend.config import DDG_URL, MAX_SEARCH_RESULTS

_LINK_RE = re.compile(
    r'<a\s+rel="nofollow"\s+class="result__a"\s+href="([^"]+)"[^>]*>(.*?)</a>',
    re.DOTALL,
)
_SNIPPET_RE = re.compile(
    r'<a\s+class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL,
)


def _strip_tags(raw: str) -> str:
    text = re.sub(r"<[^>]+>", "", raw)
    return html.unescape(text).strip()


def _decode_href(href: str) -> str:
    if "uddg=" in href:
        parsed = parse_qs(urlparse(href).query)
        values = parsed.get("uddg")
        if values:
            return values[0]
    return href


def parse_ddg_html(body: str, max_results: int = MAX_SEARCH_RESULTS) -> list[dict[str, str]]:
    links = _LINK_RE.findall(body)
    snippets = _SNIPPET_RE.findall(body)
    results: list[dict[str, str]] = []
    for i, (href, title_html) in enumerate(links[:max_results]):
        snippet = _strip_tags(snippets[i]) if i < len(snippets) else ""
        results.append({
            "title": _strip_tags(title_html),
            "url": _decode_href(href),
            "snippet": snippet,
        })
    return results


async def duckduckgo_search(
    query: str,
    max_results: int = MAX_SEARCH_RESULTS,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, str]]:
    q = (query or "").strip()
    if not q:
        return []
    cap = max(1, min(int(max_results), 10))
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=15.0)
    assert client is not None
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    last_error: Exception | None = None
    try:
        for attempt in range(2):
            try:
                resp = await client.post(
                    DDG_URL,
                    content=urlencode({"q": q}).encode("utf-8"),
                    headers=headers,
                )
                resp.raise_for_status()
                results = parse_ddg_html(resp.text, cap)
                if results:
                    return results
                # Empty page: markup changed or rate-limited — one retry, then
                # surface an explicit error row instead of silent failure.
                last_error = RuntimeError("trang kết quả rỗng (layout đổi?)")
            except Exception as exc:  # noqa: BLE001
                last_error = exc
            if attempt == 0:
                await asyncio.sleep(0.6)
        return [{"title": "Search Error", "url": "", "snippet": str(last_error)}]
    finally:
        if own_client:
            await client.aclose()


def format_search_results(results: list[dict[str, Any]]) -> str:
    if not results:
        return "Không tìm thấy kết quả."
    lines = []
    for i, item in enumerate(results, 1):
        lines.append(
            f"[{i}] {item.get('title', '')}\n"
            f"URL: {item.get('url', '')}\n"
            f"{item.get('snippet', '')}"
        )
    return "\n\n".join(lines)

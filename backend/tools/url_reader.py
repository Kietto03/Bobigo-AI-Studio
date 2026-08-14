"""Fetch a public HTTP(S) page and return readable text. Blocks SSRF."""

from __future__ import annotations

import html
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

from backend.config import MAX_REDIRECTS, MAX_URL_BYTES, URL_FETCH_TIMEOUT

_TAG_RE = re.compile(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", re.I)
_WS_RE = re.compile(r"[ \t]+\n|\n{3,}|[ \t]{2,}")


class UrlReaderError(ValueError):
    pass


def _host_ips(host: str, port: int) -> list[ipaddress._BaseAddress]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UrlReaderError(f"không resolve được host: {host}") from exc
    ips: list[ipaddress._BaseAddress] = []
    for info in infos:
        ips.append(ipaddress.ip_address(info[4][0]))
    return ips


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def validate_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise UrlReaderError("URL trống")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise UrlReaderError("chỉ cho phép http/https")
    host = parsed.hostname
    if not host:
        raise UrlReaderError("URL thiếu host")
    lowered = host.lower().rstrip(".")
    if lowered in {"localhost", "127.0.0.1", "::1", "0.0.0.0", "[::1]"}:
        raise UrlReaderError("không cho phép host nội bộ")
    if lowered.endswith(".localhost") or lowered.endswith(".local"):
        raise UrlReaderError("không cho phép host nội bộ")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    for ip in _host_ips(host, port):
        if _is_blocked_ip(ip):
            raise UrlReaderError("host trỏ tới địa chỉ không công khai")
    return raw


def html_to_text(raw: str) -> str:
    text = _TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    text = _WS_RE.sub(lambda m: "\n\n" if "\n\n" in m.group(0) else " ", text)
    return text.strip()


async def read_url(
    url: str,
    client: httpx.AsyncClient | None = None,
    max_bytes: int = MAX_URL_BYTES,
) -> str:
    current = validate_url(url)
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=URL_FETCH_TIMEOUT, follow_redirects=False)
    assert client is not None
    try:
        for _ in range(MAX_REDIRECTS + 1):
            validate_url(current)
            async with client.stream(
                "GET",
                current,
                headers={"User-Agent": "BobigoAgent/1.0"},
                timeout=URL_FETCH_TIMEOUT,
            ) as resp:
                if resp.status_code in {301, 302, 303, 307, 308}:
                    location = resp.headers.get("location")
                    if not location:
                        raise UrlReaderError("redirect thiếu Location")
                    current = urljoin(current, location)
                    continue
                resp.raise_for_status()
                chunks: list[bytes] = []
                total = 0
                async for piece in resp.aiter_bytes():
                    chunks.append(piece)
                    total += len(piece)
                    if total > max_bytes:
                        break
                data = b"".join(chunks)[:max_bytes]
                truncated = total > max_bytes
                encoding = resp.charset_encoding or "utf-8"
                text = data.decode(encoding, errors="replace")
                ctype = (resp.headers.get("content-type") or "").lower()
                if "html" in ctype or text.lstrip()[:1] == "<":
                    text = html_to_text(text)
                if truncated:
                    text += "\n\n[đã cắt bớt vì trang quá dài]"
                return text[:max_bytes]
        raise UrlReaderError("quá nhiều redirect")
    except UrlReaderError:
        raise
    except httpx.HTTPError as exc:
        raise UrlReaderError(f"không tải được URL: {exc}") from exc
    finally:
        if own_client:
            await client.aclose()

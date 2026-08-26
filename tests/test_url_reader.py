import ipaddress

import pytest

from backend.tools.url_reader import (
    UrlReaderError,
    ensure_public_resolution,
    html_to_text,
    validate_url,
)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.com/x",
        "http://localhost/admin",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://10.0.0.1/",
        "http://192.168.1.1/",
        "http://169.254.1.1/",
        "http://0.0.0.0/",
        "",
    ],
)
def test_validate_url_blocks_private_and_non_http(url):
    with pytest.raises(UrlReaderError):
        validate_url(url)


def test_html_to_text_strips_markup():
    text = html_to_text("<html><script>alert(1)</script><h1>Hi</h1><p>There</p></html>")
    assert "Hi" in text
    assert "There" in text
    assert "alert" not in text


def test_ensure_public_resolution_accepts_public(monkeypatch):
    import backend.tools.url_reader as ur

    monkeypatch.setattr(
        ur,
        "_host_ips",
        lambda host, port: [ipaddress.ip_address("93.184.216.34")],
    )
    ensure_public_resolution("http://example.com/")  # must not raise


def test_ensure_public_resolution_blocks_private_rebinding(monkeypatch):
    """First lookup passed validation; connection-time lookup went private."""
    import backend.tools.url_reader as ur

    monkeypatch.setattr(
        ur,
        "_host_ips",
        lambda host, port: [ipaddress.ip_address("10.0.0.5")],
    )
    with pytest.raises(UrlReaderError):
        ensure_public_resolution("http://evil.example.com/")


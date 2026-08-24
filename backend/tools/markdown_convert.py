"""Convert rich document bytes to Markdown via Microsoft MarkItDown.

Used by the file-attachment extractor and the "download as .md" endpoint.
Degrades gracefully: if MarkItDown isn't installed or a conversion fails, the
caller falls back to the legacy pypdf / plain-text extraction.
"""

from __future__ import annotations

import io
from pathlib import Path

# Binary / structured formats where MarkItDown adds real value (plain text and
# source code are read as-is by the legacy path, no conversion needed).
MARKITDOWN_SUFFIXES = {
    ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
    ".html", ".htm", ".epub", ".rtf", ".odt", ".ipynb", ".msg",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff",
}

_MD = None
_MD_TRIED = False


def _markitdown():
    """Lazily build a single MarkItDown instance; None if unavailable."""
    global _MD, _MD_TRIED
    if _MD_TRIED:
        return _MD
    _MD_TRIED = True
    try:
        from markitdown import MarkItDown
        _MD = MarkItDown()
    except Exception:  # noqa: BLE001 — optional dependency
        _MD = None
    return _MD


def markitdown_available() -> bool:
    return _markitdown() is not None


def convert_bytes_to_markdown(data: bytes, filename: str = "") -> str | None:
    """Return Markdown for the given bytes, or None if conversion isn't possible."""
    md = _markitdown()
    if md is None or not data:
        return None
    suffix = Path(filename).suffix.lower() if filename else ""
    try:
        result = md.convert_stream(
            io.BytesIO(data), file_extension=suffix or None
        )
        text = (result.text_content or "").strip()
        return text or None
    except Exception:  # noqa: BLE001 — let the caller fall back
        return None

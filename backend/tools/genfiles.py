"""Storage + metadata plumbing for files the agent generates.

Generated files live on disk under ``generated/`` (named ``<id>__<safeName>``)
and are served by ``GET /api/files/{id}``. File-generation tools return a normal
human string with a hidden **marker** appended; ``_run_calls`` (agent loop) parses
the marker into ``event["files"]`` and strips it before the model sees the result.
"""

from __future__ import annotations

import json
import mimetypes
import re
import uuid
from pathlib import Path

from backend.config import BASE_DIR

GENERATED_DIR = Path(BASE_DIR) / "generated"

# Unit-separator delimited marker — invisible, never valid in normal prose.
_UNIT = "\x1f\x1f"
_MARKER_RE = re.compile(r"\x1f\x1f(\{.*?\})\x1f\x1f", re.S)
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")

_MIME_OVERRIDES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".svg": "image/svg+xml",
    ".ts": "text/plain",
    ".tsx": "text/plain",
}


def _safe_name(name: str) -> str:
    base = (name or "file").strip().replace(" ", "_")
    base = _UNSAFE.sub("-", base).strip("-") or "file"
    return base[:80]


def file_kind(name: str) -> str:
    """Coarse category used by the frontend to pick a preview renderer."""
    ext = Path(name).suffix.lower()
    if ext in {".md", ".markdown"}:
        return "markdown"
    if ext in {".csv", ".tsv"}:
        return "csv"
    if ext in {".html", ".htm"}:
        return "html"
    if ext == ".svg":
        return "svg"
    if ext in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}:
        return "image"
    if ext == ".docx":
        return "docx"
    if ext == ".xlsx":
        return "xlsx"
    if ext == ".pdf":
        return "pdf"
    code = {".py", ".js", ".ts", ".jsx", ".tsx", ".json", ".css", ".xml", ".yaml",
            ".yml", ".sql", ".sh", ".c", ".cpp", ".h", ".hpp", ".rs", ".go",
            ".java", ".php", ".rb", ".swift", ".kt", ".toml", ".ini", ".cfg"}
    if ext in code:
        return "code"
    return "text"


def save_generated_file(name: str, data: bytes) -> dict:
    """Persist bytes; return metadata {id, name, mime, size, kind}."""
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    fid = uuid.uuid4().hex[:12]
    safe = _safe_name(name)
    (GENERATED_DIR / f"{fid}__{safe}").write_bytes(data)
    ext = Path(safe).suffix.lower()
    mime = _MIME_OVERRIDES.get(ext) or mimetypes.guess_type(safe)[0] or "application/octet-stream"
    return {"id": fid, "name": safe, "mime": mime, "size": len(data), "kind": file_kind(safe)}


def resolve_generated(fid: str) -> Path | None:
    """Locate a stored file by id (path-traversal safe)."""
    if not fid or not re.fullmatch(r"[A-Za-z0-9]{6,32}", fid):
        return None
    matches = sorted(GENERATED_DIR.glob(f"{fid}__*"))
    return matches[0] if matches else None


def encode_file_marker(meta: dict) -> str:
    return _UNIT + json.dumps(meta, ensure_ascii=False) + _UNIT


def extract_file_markers(text: str) -> tuple[str, list[dict]]:
    """Split a tool result into (clean_text, [file_metadata])."""
    if not text or _UNIT not in text:
        return text, []
    files: list[dict] = []
    for m in _MARKER_RE.finditer(text):
        try:
            files.append(json.loads(m.group(1)))
        except json.JSONDecodeError:
            pass
    clean = _MARKER_RE.sub("", text).strip()
    return clean, files

"""Read and list text files inside the project workspace only."""

from __future__ import annotations

from pathlib import Path

from backend.config import BASE_DIR, MAX_LIST_ENTRIES, MAX_READ_BYTES

_BLOCKED_DIRS = {".git", ".venv", "__pycache__", "node_modules", ".mypy_cache", ".pytest_cache"}
_BLOCKED_NAMES = {".env", ".env.local", ".env.production", ".netrc"}
_BLOCKED_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".crt", ".der"}
_TEXT_SUFFIXES = {
    ".py", ".md", ".txt", ".json", ".js", ".css", ".html", ".htm",
    ".sh", ".ini", ".toml", ".yml", ".yaml", ".cfg", ".xml",
    ".csv", ".tsv", ".rst", ".svg", ".pdf", ".sql", ".log",
    ".c", ".cpp", ".h", ".hpp", ".rs", ".go", ".java", ".php",
    ".rb", ".swift", ".kt", ".env.example",
}


class FileToolError(ValueError):
    pass


def _root() -> Path:
    return Path(BASE_DIR).resolve()


def extract_text_from_bytes(data: bytes, filename: str = "", max_bytes: int = MAX_READ_BYTES) -> str:
    suffix = Path(filename).suffix.lower() if filename else ""
    if suffix == ".pdf":
        try:
            import io
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            pages_text: list[str] = []
            total_len = 0
            for idx, page in enumerate(reader.pages, start=1):
                txt = (page.extract_text() or "").strip()
                if not txt:
                    continue
                header = f"--- Trang {idx} ---\n"
                pages_text.append(header + txt)
                total_len += len(header) + len(txt)
                if total_len > max_bytes:
                    pages_text.append("\n[đã cắt bớt vì tài liệu quá dài]")
                    break
            return "\n\n".join(pages_text) if pages_text else "[Không tìm thấy nội dung văn bản trong tệp PDF này]"
        except Exception as exc:
            raise FileToolError(f"Lỗi đọc tệp PDF: {exc}") from exc

    # Standard text-based formats
    text = data[:max_bytes].decode("utf-8", errors="replace")
    if len(data) > max_bytes:
        return text + "\n\n[đã cắt bớt vì file quá dài]"
    return text


def resolve_in_workspace(rel: str) -> Path:
    raw = (rel or "").strip() or "."
    root = _root()
    candidate = Path(raw)
    target = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise FileToolError("đường dẫn nằm ngoài workspace") from exc
    for part in target.relative_to(root).parts:
        if part in _BLOCKED_DIRS:
            raise FileToolError(f"không được truy cập {part}")
    return target


def _is_secret_file(path: Path) -> bool:
    name = path.name
    if name in _BLOCKED_NAMES or name.startswith(".env"):
        return True
    if path.suffix.lower() in _BLOCKED_SUFFIXES:
        return True
    return False


def read_workspace_file(path: str, max_bytes: int = MAX_READ_BYTES) -> str:
    target = resolve_in_workspace(path)
    if not target.exists():
        raise FileToolError(f"không tồn tại: {path}")
    if not target.is_file():
        raise FileToolError("không phải file")
    if _is_secret_file(target):
        raise FileToolError("file bị chặn")
    if target.suffix.lower() not in _TEXT_SUFFIXES:
        raise FileToolError(f"chỉ đọc file văn bản hoặc PDF ({', '.join(sorted(_TEXT_SUFFIXES))})")
    data = target.read_bytes()
    rel = target.relative_to(_root()).as_posix()
    content = extract_text_from_bytes(data, filename=target.name, max_bytes=max_bytes)
    return f"# {rel}\n" + content


def list_workspace_files(path: str = ".", pattern: str = "*") -> str:
    target = resolve_in_workspace(path)
    if not target.exists():
        raise FileToolError(f"không tồn tại: {path}")
    if target.is_file():
        return target.relative_to(_root()).as_posix()
    glob = (pattern or "*").strip() or "*"
    if ".." in Path(glob).parts:
        raise FileToolError("pattern không hợp lệ")
    root = _root()
    entries: list[str] = []

    def _walk(folder: Path) -> None:
        if len(entries) >= MAX_LIST_ENTRIES:
            return
        try:
            children = sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        for item in children:
            if item.name in _BLOCKED_DIRS:
                continue
            try:
                rel = item.relative_to(root)
            except ValueError:
                continue
            if item.is_dir():
                entries.append(rel.as_posix() + "/")
                if len(entries) >= MAX_LIST_ENTRIES:
                    entries.append(f"... (cắt ở {MAX_LIST_ENTRIES} mục)")
                    return
                _walk(item)
                continue
            if _is_secret_file(item):
                continue
            if glob != "*" and not item.match(glob):
                continue
            entries.append(rel.as_posix())
            if len(entries) >= MAX_LIST_ENTRIES:
                entries.append(f"... (cắt ở {MAX_LIST_ENTRIES} mục)")
                return

    _walk(target)
    if not entries:
        return "(trống)"
    return "\n".join(entries)

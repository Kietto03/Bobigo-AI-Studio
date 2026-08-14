from pathlib import Path

import pytest

from backend.config import BASE_DIR
from backend.tools.files import FileToolError, list_workspace_files, read_workspace_file, resolve_in_workspace


def test_read_config():
    text = read_workspace_file("backend/config.py")
    assert "DEFAULT_MODEL" in text
    assert text.startswith("# backend/config.py")


def test_rejects_path_escape():
    with pytest.raises(FileToolError):
        resolve_in_workspace("../etc/passwd")
    with pytest.raises(FileToolError):
        resolve_in_workspace("/etc/passwd")


def test_rejects_venv_and_env(tmp_path, monkeypatch):
    env = Path(BASE_DIR) / ".env"
    created = False
    if not env.exists():
        env.write_text("SECRET=1", encoding="utf-8")
        created = True
    try:
        with pytest.raises(FileToolError):
            read_workspace_file(".env")
    finally:
        if created:
            env.unlink(missing_ok=True)

    with pytest.raises(FileToolError):
        resolve_in_workspace(".venv/pyvenv.cfg")


def test_list_files_finds_python():
    listing = list_workspace_files("backend", "*.py")
    assert "backend/config.py" in listing
    assert ".venv" not in listing

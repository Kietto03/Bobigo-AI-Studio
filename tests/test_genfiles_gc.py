"""Tests for the generated/ garbage collector."""

import os
import time

from backend.tools import genfiles


def _make_file(directory, name, age_hours):
    path = directory / name
    path.write_bytes(b"x")
    old = time.time() - age_hours * 3600
    os.utime(path, (old, old))
    return path


def test_cleanup_removes_only_old_files(tmp_path, monkeypatch):
    monkeypatch.setattr(genfiles, "GENERATED_DIR", tmp_path)
    stale = _make_file(tmp_path, "aaa__old.docx", age_hours=100)
    fresh = _make_file(tmp_path, "bbb__new.xlsx", age_hours=1)

    removed = genfiles.cleanup_generated(max_age_hours=72)

    assert removed == 1
    assert not stale.exists()
    assert fresh.exists()


def test_cleanup_noop_when_dir_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(genfiles, "GENERATED_DIR", tmp_path / "does-not-exist")
    assert genfiles.cleanup_generated(max_age_hours=72) == 0


def test_cleanup_disabled_with_nonpositive_ttl(tmp_path, monkeypatch):
    monkeypatch.setattr(genfiles, "GENERATED_DIR", tmp_path)
    target = _make_file(tmp_path, "ccc__ancient.pdf", age_hours=9999)

    assert genfiles.cleanup_generated(max_age_hours=0) == 0
    assert target.exists()

"""Run a short Python snippet in a restricted subprocess."""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import tempfile
import textwrap

from backend.config import CODE_EXEC_TIMEOUT

_ALLOWED_MODULES = frozenset({
    "math",
    "cmath",
    "decimal",
    "fractions",
    "statistics",
    "json",
    "re",
    "datetime",
    "time",
    "collections",
    "itertools",
    "functools",
    "operator",
    "string",
    "textwrap",
    "unicodedata",
    "random",
    "hashlib",
    "base64",
    "copy",
    "typing",
    "dataclasses",
    "heapq",
    "bisect",
    "array",
    "numbers",
})

_RUNNER = textwrap.dedent(
    """\
    import builtins
    import sys

    ALLOWED = {allowed}

    _real_import = builtins.__import__

    def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.split(".", 1)[0]
        if root not in ALLOWED:
            raise ImportError(f"import '{{name}}' is not allowed")
        return _real_import(name, globals, locals, fromlist, level)

    path = sys.argv[1]
    with open(path, "r", encoding="utf-8") as fh:
        source = fh.read()
    _exec = exec
    _compile = compile

    builtins.__import__ = _guarded_import
    for _name in ("eval", "exec", "compile", "open", "input", "breakpoint", "help", "exit", "quit"):
        if hasattr(builtins, _name):
            delattr(builtins, _name)

    ns = {{"__name__": "__main__"}}
    _exec(_compile(source, "<user>", "exec"), ns, ns)
    """
).format(allowed=repr(sorted(_ALLOWED_MODULES)))


class CodeInterpreterError(ValueError):
    pass


def _assert_safe_ast(source: str) -> None:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise CodeInterpreterError(f"cú pháp không hợp lệ: {exc}") from exc
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise CodeInterpreterError("không cho phép truy cập thuộc tính nội bộ")
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise CodeInterpreterError("không cho phép tên bắt đầu bằng _")


def run_python(code: str, timeout: int = CODE_EXEC_TIMEOUT) -> str:
    source = (code or "").strip()
    if not source:
        raise CodeInterpreterError("mã trống")
    if len(source) > 20_000:
        raise CodeInterpreterError("mã quá dài")
    _assert_safe_ast(source)

    with tempfile.TemporaryDirectory(prefix="bobigo-code-") as tmp:
        user_path = os.path.join(tmp, "user_code.py")
        runner_path = os.path.join(tmp, "runner.py")
        with open(user_path, "w", encoding="utf-8") as fh:
            fh.write(source)
        with open(runner_path, "w", encoding="utf-8") as fh:
            fh.write(_RUNNER)
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        try:
            proc = subprocess.run(
                [sys.executable, "-I", runner_path, user_path],
                cwd=tmp,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise CodeInterpreterError(f"timeout sau {timeout}s") from exc

    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode != 0:
        detail = err or out or f"exit {proc.returncode}"
        raise CodeInterpreterError(detail[:4000])
    if err and not out:
        return err[:4000]
    if err:
        return f"{out}\n[stderr]\n{err}"[:4000]
    return out or "(không có output)"

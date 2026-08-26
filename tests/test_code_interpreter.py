import pytest

from backend.tools.code_interpreter import CodeInterpreterError, run_python


def test_print_output():
    assert "hello" in run_python("print('hello')")


def test_timeout():
    with pytest.raises(CodeInterpreterError, match="timeout"):
        run_python("while True:\n    pass", timeout=1)


def test_blocks_os_import():
    with pytest.raises(CodeInterpreterError):
        run_python("import os\nprint(os.getcwd())")


def test_blocks_dunder_escape():
    with pytest.raises(CodeInterpreterError):
        run_python("print((1).__class__)")


def test_build_exec_cmd_local_default():
    import sys

    from backend.tools.code_interpreter import build_exec_cmd

    cmd = build_exec_cmd("/tmp/r.py", "/tmp/u.py", runtime="local")
    assert cmd[:3] == [sys.executable, "-I", "/tmp/r.py"]
    assert cmd[3] == "/tmp/u.py"
    assert "docker" not in cmd


def test_build_exec_cmd_docker_opt_in():
    from backend.tools.code_interpreter import build_exec_cmd

    cmd = build_exec_cmd(
        "/tmp/bobigo-code-xyz/runner.py",
        "/tmp/bobigo-code-xyz/user_code.py",
        runtime="docker",
        image="python:3.12-slim",
    )
    assert cmd[0] == "docker"
    assert "--network" in cmd and "none" in cmd
    assert "-v" in cmd and "/sandbox" in " ".join(cmd)
    assert "-I" in cmd  # isolated mode kept inside the container too


def test_run_python_still_works_locally():
    out = run_python("print(21 * 2)")
    assert "42" in out

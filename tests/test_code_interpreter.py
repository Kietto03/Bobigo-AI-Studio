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

import pytest

from backend.tools.calculator import CalculatorError, calculate


def test_basic_arithmetic():
    assert calculate("2+2") == "4"
    assert calculate("10 / 4") == "2.5"
    assert calculate("2**10") == "1024"
    assert calculate("-(3 + 4)") == "-7"


def test_functions_and_constants():
    assert calculate("sqrt(16)") == "4"
    assert calculate("round(pi, 2)") == "3.14"
    assert calculate("log(e)") == "1"


def test_rejects_empty_and_unsafe():
    with pytest.raises(CalculatorError):
        calculate("")
    with pytest.raises(CalculatorError):
        calculate("__import__('os')")
    with pytest.raises(CalculatorError):
        calculate("os.system('id')")
    with pytest.raises(CalculatorError):
        calculate("'a' * 10")
    with pytest.raises(CalculatorError):
        calculate("2+2; import os")

"""Safe arithmetic evaluator — AST only, no eval/exec."""

from __future__ import annotations

import ast
import math
import operator
from typing import Any

_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

_UNARY_OPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}

_FUNCS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "asin": math.asin,
    "acos": math.acos,
    "atan": math.atan,
    "atan2": math.atan2,
    "log": math.log,
    "log10": math.log10,
    "log2": math.log2,
    "exp": math.exp,
    "floor": math.floor,
    "ceil": math.ceil,
    "fabs": math.fabs,
    "degrees": math.degrees,
    "radians": math.radians,
    "sinh": math.sinh,
    "cosh": math.cosh,
    "tanh": math.tanh,
    "pow": math.pow,
    "hypot": math.hypot,
}

_NAMES = {
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
    "inf": math.inf,
}


class CalculatorError(ValueError):
    pass


def _eval(node: ast.AST) -> Any:
    if isinstance(node, ast.Expression):
        return _eval(node.body)

    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise CalculatorError("chỉ chấp nhận số")
        return node.value

    if isinstance(node, ast.BinOp):
        op = _BIN_OPS.get(type(node.op))
        if op is None:
            raise CalculatorError("toán tử không được hỗ trợ")
        left = _eval(node.left)
        right = _eval(node.right)
        try:
            return op(left, right)
        except ZeroDivisionError as exc:
            raise CalculatorError("chia cho 0") from exc

    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise CalculatorError("toán tử một ngôi không được hỗ trợ")
        return op(_eval(node.operand))

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise CalculatorError("chỉ gọi hàm theo tên")
        fn = _FUNCS.get(node.func.id)
        if fn is None:
            raise CalculatorError(f"hàm không được hỗ trợ: {node.func.id}")
        if node.keywords:
            raise CalculatorError("không hỗ trợ keyword argument")
        args = [_eval(a) for a in node.args]
        try:
            return fn(*args)
        except Exception as exc:
            raise CalculatorError(str(exc)) from exc

    if isinstance(node, ast.Name):
        if node.id not in _NAMES:
            raise CalculatorError(f"tên không được hỗ trợ: {node.id}")
        return _NAMES[node.id]

    raise CalculatorError(f"biểu thức không hợp lệ: {type(node).__name__}")


def calculate(expression: str) -> str:
    expr = (expression or "").strip()
    if not expr:
        raise CalculatorError("biểu thức trống")
    if len(expr) > 500:
        raise CalculatorError("biểu thức quá dài")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise CalculatorError("cú pháp không hợp lệ") from exc
    result = _eval(tree)
    if isinstance(result, float) and result.is_integer():
        result = int(result)
    return str(result)

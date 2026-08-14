"""Merge streamed tool-call deltas and recover tool calls from model text."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

_TOOL_JSON_RE = re.compile(
    r"<tool_call>\s*(\{.*?\})\s*</tool_call>",
    re.DOTALL,
)
_TOOL_FENCE_RE = re.compile(
    r"```(?:json|tool_call)\s*(\{.*?\})\s*```",
    re.DOTALL,
)
_QWEN_XML_RE = re.compile(
    r"<tool_call>\s*([A-Za-z_][\w]*)\s*(?:```(?:json)?\s*)?(\{.*?\})\s*(?:```)?\s*</tool_call>",
    re.DOTALL,
)
_QWEN_FLOWER_RE = re.compile(
    r"✿FUNCTION✿\s*([A-Za-z_][\w]*)\s*✿ARGS✿\s*(\{.*?\})",
    re.DOTALL,
)
_THINK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL | re.I)


def new_call_id(name: str) -> str:
    return f"call_{name}_{uuid.uuid4().hex[:10]}"


def merge_tool_call_delta(acc: dict[int, dict[str, Any]], deltas: list[dict[str, Any]]) -> None:
    for delta in deltas:
        idx = int(delta.get("index") or 0)
        slot = acc.setdefault(
            idx,
            {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
        )
        if delta.get("id"):
            slot["id"] = delta["id"]
        if delta.get("type"):
            slot["type"] = delta["type"]
        fn = delta.get("function") or {}
        if fn.get("name"):
            slot["function"]["name"] += fn["name"]
        if fn.get("arguments"):
            slot["function"]["arguments"] += fn["arguments"]


def finalized_tool_calls(acc: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for idx in sorted(acc):
        item = acc[idx]
        name = (item.get("function") or {}).get("name") or ""
        if not name:
            continue
        if not item.get("id"):
            item["id"] = new_call_id(name)
        item["type"] = item.get("type") or "function"
        calls.append(item)
    return calls


def _as_call(name: str, arguments: Any) -> dict[str, Any]:
    if isinstance(arguments, dict):
        arg_str = json.dumps(arguments, ensure_ascii=False)
    else:
        arg_str = str(arguments)
    return {
        "id": new_call_id(name),
        "type": "function",
        "function": {"name": name, "arguments": arg_str},
    }


def _object_to_call(obj: dict[str, Any]) -> dict[str, Any] | None:
    name = obj.get("name") or obj.get("function")
    if isinstance(name, dict):
        inner = name
        name = inner.get("name")
        arguments = obj.get("arguments", inner.get("arguments", {}))
    else:
        arguments = obj.get("arguments") or obj.get("parameters") or obj.get("args") or {}
    if not isinstance(name, str) or not name:
        return None
    return _as_call(name, arguments)


def extract_tool_calls_from_text(text: str) -> list[dict[str, Any]]:
    if not text:
        return []
    found: list[dict[str, Any]] = []

    for pattern in (_TOOL_JSON_RE, _TOOL_FENCE_RE):
        for raw in pattern.findall(text):
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                call = _object_to_call(obj)
                if call:
                    found.append(call)

    for name, raw_args in _QWEN_XML_RE.findall(text):
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {"value": raw_args}
        found.append(_as_call(name, args))

    for name, raw_args in _QWEN_FLOWER_RE.findall(text):
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {"value": raw_args}
        found.append(_as_call(name, args))

    # de-dupe by (name, arguments)
    uniq: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for call in found:
        key = (call["function"]["name"], call["function"]["arguments"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(call)
    return uniq


_STRIP_TOOL_RE = re.compile(
    r"<tool_call>[\s\S]*?</tool_call>|✿FUNCTION✿[\s\S]*?✿ARGS✿\s*\{.*?\}|```(?:json|tool_call)\s*\{.*?\}\s*```",
    re.DOTALL,
)


def looks_like_tool_markup(text: str) -> bool:
    if not text:
        return False
    lowered = text.lower()
    return "<tool_call" in lowered or "✿function✿" in lowered or "✿FUNCTION✿" in text


def strip_tool_markup(text: str) -> str:
    if not text:
        return ""
    return _STRIP_TOOL_RE.sub("", text).strip()


def split_think_tags(text: str) -> tuple[str, str]:
    """Return (reasoning, visible_content) if <think> blocks are present."""
    if not text or "<think>" not in text.lower():
        return "", text
    thoughts = [m.group(1).strip() for m in _THINK_RE.finditer(text)]
    visible = _THINK_RE.sub("", text).strip()
    return "\n\n".join(thoughts), visible

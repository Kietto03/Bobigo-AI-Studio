"""Keep the prompt inside the local context window."""

from __future__ import annotations

import json
from typing import Any

from backend.config import CONTEXT_WINDOW, REPLY_RESERVE, TOOL_RESULT_CAP


def estimate_tokens(text: str) -> int:
    return max(1, (len(text) + 3) // 4)


def _message_tokens(message: dict[str, Any]) -> int:
    content = message.get("content")
    blob = content if isinstance(content, str) else ""
    if message.get("tool_calls"):
        blob += json.dumps(message["tool_calls"], ensure_ascii=False)
    if message.get("reasoning_content"):
        blob += str(message["reasoning_content"])
    return estimate_tokens(blob) + 8


def _cap_tool_content(message: dict[str, Any]) -> dict[str, Any]:
    out = dict(message)
    content = out.get("content")
    if out.get("role") == "tool" and isinstance(content, str) and len(content) > TOOL_RESULT_CAP:
        out["content"] = content[:TOOL_RESULT_CAP] + "\n[đã cắt bớt]"
    return out


def trim_messages(
    messages: list[dict[str, Any]],
    *,
    window: int = CONTEXT_WINDOW,
    reserve: int = REPLY_RESERVE,
) -> list[dict[str, Any]]:
    reserve = max(256, min(reserve, window - 512))
    budget = max(512, window - reserve)
    prepared = [_cap_tool_content(m) for m in messages]
    system = [m for m in prepared if m.get("role") == "system"]
    rest = [m for m in prepared if m.get("role") != "system"]
    used = sum(_message_tokens(m) for m in system)

    kept: list[dict[str, Any]] = []
    for msg in reversed(rest):
        cost = _message_tokens(msg)
        if kept and used + cost > budget:
            break
        kept.append(msg)
        used += cost
    kept.reverse()

    while kept and kept[0].get("role") == "tool":
        kept.pop(0)
    return system + kept

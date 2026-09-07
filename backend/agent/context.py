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


def _truncate_content(message: dict[str, Any], keep_chars: int) -> dict[str, Any]:
    """Shorten a message's text content to keep_chars, biased to the head (the
    user's question sits before any appended attachment text) plus a small tail."""
    out = dict(message)
    content = out.get("content")
    if not isinstance(content, str) or len(content) <= keep_chars:
        return out
    keep_chars = max(200, keep_chars)
    head = int(keep_chars * 0.85)
    tail = keep_chars - head - 60
    out["content"] = (
        content[:head]
        + "\n\n[... đã cắt bớt nội dung quá dài để vừa cửa sổ ngữ cảnh ...]\n\n"
        + (content[-tail:] if tail > 40 else "")
    )
    return out


def trim_messages(
    messages: list[dict[str, Any]],
    *,
    window: int = CONTEXT_WINDOW,
    reserve: int = REPLY_RESERVE,
) -> list[dict[str, Any]]:
    reserve = max(256, min(reserve, window - 512))
    # Our char/4 estimate under-counts real tokens (Vietnamese diacritics tokenize
    # heavily, ~1.45x), and the payload also carries the tool schemas + chat
    # template overhead (~900 tokens) that aren't in `messages`. Shrink the budget
    # accordingly so the *rendered* prompt never exceeds n_ctx (→ 400).
    _TOKEN_SAFETY = 1.45
    _TOOLS_OVERHEAD = 900
    budget = max(512, int((window - reserve - _TOOLS_OVERHEAD) / _TOKEN_SAFETY))
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

    # The Qwen --jinja chat template raises a 500 ("No user query found in
    # messages") if the prompt contains no user message. Trimming a long tool
    # loop — or stripping a leading tool result — can remove every user turn, so
    # guarantee the most recent user message survives.
    if not any(m.get("role") == "user" for m in kept):
        last_user = next((m for m in reversed(rest) if m.get("role") == "user"), None)
        if last_user is not None:
            kept.insert(0, last_user)

    result = system + kept

    # Final safety: the prompt MUST fit the context window, or llama-server
    # returns 400 ("exceeds the available context size"). A single huge message
    # (e.g. two large attachments pasted into one user turn) can still blow the
    # budget even after selection + guaranteed-user, so truncate the largest
    # message content until the whole prompt fits.
    def _total(msgs: list[dict[str, Any]]) -> int:
        return sum(_message_tokens(m) for m in msgs)

    guard = 0
    while _total(result) > budget and guard < 100:
        guard += 1
        idx = max(
            range(len(result)),
            key=lambda i: len(result[i].get("content") or "") if isinstance(result[i].get("content"), str) else 0,
        )
        content = result[idx].get("content")
        if not isinstance(content, str) or len(content) <= 400:
            break
        over_chars = (_total(result) - budget) * 4 + 200
        result[idx] = _truncate_content(result[idx], max(200, len(content) - over_chars))

    return result

"""Keep the prompt inside the local context window."""

from __future__ import annotations

import json
from typing import Any

from backend.config import CONTEXT_WINDOW, REPLY_RESERVE, TOOL_RESULT_CAP


def estimate_tokens(text: str) -> int:
    """Accurately estimate token count for LLMs (Qwen/Llama BPE tokenizers).

    For pure ASCII: ~3.5 to 4 characters per token.
    For non-ASCII (Vietnamese diacritics, UTF-8 multibyte, symbols):
    syllables decompose into multiple BPE tokens (~0.85 tokens/char).
    Guarantees a conservative upper bound so prompts never overflow llama-server context.
    """
    if not text:
        return 0
    non_ascii = sum(1 for c in text if ord(c) >= 128)
    ascii_len = len(text) - non_ascii
    if non_ascii == 0:
        return max(1, (ascii_len + 3) // 4)
    est = (ascii_len + 3) // 4 + int(non_ascii * 0.85 + 0.99)
    return max(1, est)


def _message_tokens(message: dict[str, Any]) -> int:
    content = message.get("content")
    blob = content if isinstance(content, str) else ""
    if message.get("tool_calls"):
        blob += json.dumps(message["tool_calls"], ensure_ascii=False)
    if message.get("reasoning_content"):
        blob += str(message["reasoning_content"])
    return estimate_tokens(blob) + 8


MAX_USER_MESSAGE_CHARS = 16_000


def _cap_message_content(message: dict[str, Any]) -> dict[str, Any]:
    out = dict(message)
    content = out.get("content")
    if not isinstance(content, str):
        return out
    role = out.get("role")
    if role == "tool" and len(content) > TOOL_RESULT_CAP:
        out["content"] = content[:TOOL_RESULT_CAP] + "\n[đã cắt bớt]"
    elif role == "user" and len(content) > MAX_USER_MESSAGE_CHARS:
        half = MAX_USER_MESSAGE_CHARS // 2
        out["content"] = (
            content[:half]
            + f"\n\n[...Nội dung dài ({len(content):,} ký tự) đã được lược bớt để vừa vặn ngữ cảnh mô hình...]\n\n"
            + content[-half:]
        )
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


def _cluster_messages(messages: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group messages into atomic turns.

    An assistant message with tool_calls and its matching tool messages MUST stay
    together as an atomic unit. Separating them breaks Jinja/OpenAI chat templates
    and causes 500 crashes.
    """
    clusters: list[list[dict[str, Any]]] = []
    i = 0
    n = len(messages)
    while i < n:
        msg = messages[i]
        if msg.get("role") == "assistant" and msg.get("tool_calls"):
            group = [msg]
            expected_ids = {
                tc.get("id") for tc in msg["tool_calls"] if isinstance(tc, dict) and tc.get("id")
            }
            j = i + 1
            while j < n and messages[j].get("role") == "tool":
                tool_msg = messages[j]
                group.append(tool_msg)
                tool_id = tool_msg.get("tool_call_id")
                if tool_id in expected_ids:
                    expected_ids.remove(tool_id)
                j += 1
            clusters.append(group)
            i = j
        else:
            clusters.append([msg])
            i += 1
    return clusters


def trim_messages(
    messages: list[dict[str, Any]],
    *,
    window: int = CONTEXT_WINDOW,
    reserve: int = REPLY_RESERVE,
) -> list[dict[str, Any]]:
    reserve = max(256, min(reserve, window - 512))
    _TOOLS_OVERHEAD = 512
    budget = max(512, window - reserve - _TOOLS_OVERHEAD)
    prepared = [_cap_message_content(m) for m in messages]
    system = [m for m in prepared if m.get("role") == "system"]
    rest = [m for m in prepared if m.get("role") != "system"]
    used = sum(_message_tokens(m) for m in system)

    clusters = _cluster_messages(rest)
    kept_clusters: list[list[dict[str, Any]]] = []
    for group in reversed(clusters):
        cost = sum(_message_tokens(m) for m in group)
        if kept_clusters and used + cost > budget:
            break
        kept_clusters.append(group)
        used += cost

    kept_clusters.reverse()
    kept = [m for group in kept_clusters for m in group]

    # Clean any dangling leading tool messages
    while kept and kept[0].get("role") == "tool":
        kept.pop(0)

    # Sanitize tool-call integrity: ensure every tool message has its assistant
    known_tool_call_ids: set[str] = set()
    for m in kept:
        if m.get("role") == "assistant" and m.get("tool_calls"):
            for tc in m["tool_calls"]:
                if isinstance(tc, dict) and tc.get("id"):
                    known_tool_call_ids.add(tc["id"])

    clean_kept: list[dict[str, Any]] = []
    for m in kept:
        if m.get("role") == "tool":
            if m.get("tool_call_id") in known_tool_call_ids:
                clean_kept.append(m)
        else:
            clean_kept.append(m)
    kept = clean_kept

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

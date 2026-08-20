"""Summarize older chat turns into a compact memory when context overflows.

The summary is produced once (via a non-streaming LLM call) and the frontend
persists it in place of the old turns, so it is not recomputed every request.
``trim_messages`` remains the final safety net for hard overflow.
"""

from __future__ import annotations

from typing import Any

import httpx

from backend.config import DEFAULT_MODEL, LLM_BASE_URL, LLM_TIMEOUT

_SUMMARY_SYSTEM_VI = (
    "Bạn là bộ nén hội thoại. Tóm tắt đoạn hội thoại dưới đây thành một BẢN GHI NHỚ "
    "ngắn gọn bằng tiếng Việt để mô hình tiếp tục cuộc trò chuyện mà không mất ngữ cảnh.\n"
    "Giữ lại: sự kiện & quyết định quan trọng, dữ kiện/con số, tên riêng, ràng buộc và "
    "yêu cầu người dùng đặt ra, trạng thái công việc đang dở.\n"
    "Bỏ đi: lời chào, lặp lại, xã giao.\n"
    "Chỉ trả về nội dung tóm tắt, dùng gạch đầu dòng, không lời dẫn."
)

_SUMMARY_SYSTEM_EN = (
    "You are a conversation compressor. Summarize the conversation below into a short "
    "MEMORY note in English so the model can continue without losing context.\n"
    "Keep: important events & decisions, facts/numbers, proper names, constraints and "
    "user requests, the state of any unfinished task.\n"
    "Drop: greetings, repetition, small talk.\n"
    "Return the summary only, as bullet points, with no preamble."
)


def _role_label(role: str, language: str) -> str:
    if language == "en":
        return {"user": "User", "assistant": "Assistant", "tool": "Tool", "system": "System"}.get(role, role)
    return {"user": "Người dùng", "assistant": "Trợ lý", "tool": "Công cụ", "system": "Hệ thống"}.get(role, role)


def render_transcript(messages: list[dict[str, Any]], language: str = "vi", max_chars: int = 24_000) -> str:
    """Flatten messages into a plain transcript the summarizer can read."""
    lines: list[str] = []
    for msg in messages:
        role = str(msg.get("role") or "user")
        if role == "system":
            continue
        content = msg.get("content")
        text = content if isinstance(content, str) else ""
        if not text and msg.get("tool_calls"):
            names = ", ".join(
                (tc.get("function") or {}).get("name", "") for tc in msg["tool_calls"]
            )
            text = f"[gọi công cụ: {names}]" if language != "en" else f"[tool call: {names}]"
        text = (text or "").strip()
        if not text:
            continue
        lines.append(f"{_role_label(role, language)}: {text}")
    transcript = "\n\n".join(lines)
    if len(transcript) > max_chars:
        # Keep the newest content — that is what matters most for continuity.
        transcript = "…\n\n" + transcript[-max_chars:]
    return transcript


async def summarize_messages(
    messages: list[dict[str, Any]],
    client: httpx.AsyncClient,
    *,
    model: str | None = None,
    language: str = "vi",
) -> str:
    """Return a compact memory summary of ``messages``. Raises on LLM/parse errors."""
    lang = "en" if str(language).lower().startswith("en") else "vi"
    transcript = render_transcript(messages, lang)
    if not transcript.strip():
        return ""
    system = _SUMMARY_SYSTEM_EN if lang == "en" else _SUMMARY_SYSTEM_VI
    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": transcript},
        ],
        "temperature": 0.3,
        "max_tokens": 700,
        "stream": False,
    }
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/chat/completions"
    resp = await client.post(url, json=payload, timeout=min(LLM_TIMEOUT, 120))
    resp.raise_for_status()
    data = resp.json()
    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    return content.strip()

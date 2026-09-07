"""Summarize an extracted document into structured Markdown (map-reduce for long docs)."""

from __future__ import annotations

import httpx

from backend.config import CONTEXT_WINDOW, DEFAULT_MODEL, LLM_BASE_URL, LLM_TIMEOUT

_SYS_VI = (
    "Bạn là trợ lý tóm tắt tài liệu. Đọc nội dung và viết BẢN TÓM TẮT bằng tiếng Việt "
    "dưới dạng Markdown có cấu trúc: một tiêu đề `#`, các mục chính bằng `##`, và gạch "
    "đầu dòng cho ý/dữ kiện/con số quan trọng. Giữ lại tên riêng, ngày tháng, số liệu, "
    "kết luận. Ngắn gọn, trung thực với nội dung, không bịa. Chỉ trả về Markdown."
)
_SYS_EN = (
    "You are a document-summarizing assistant. Read the content and write a SUMMARY in "
    "English as structured Markdown: one `#` title, `##` sections, and bullet points for "
    "key facts/numbers. Keep names, dates, figures and conclusions. Be concise and "
    "faithful, never invent. Return Markdown only."
)


def _chunks(text: str, size: int) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)]


async def _complete(client: httpx.AsyncClient, system: str, user: str,
                    model: str | None, max_tokens: int) -> str:
    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "stream": False,
    }
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/chat/completions"
    resp = await client.post(url, json=payload, timeout=min(LLM_TIMEOUT, 180))
    resp.raise_for_status()
    data = resp.json()
    return ((((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or "").strip()


async def summarize_document(
    text: str, client: httpx.AsyncClient, *, model: str | None = None, language: str = "vi"
) -> str:
    lang = "en" if str(language).lower().startswith("en") else "vi"
    system = _SYS_EN if lang == "en" else _SYS_VI
    text = (text or "").strip()
    if not text:
        return ""

    # Leave room for the prompt + reply (~4 chars/token).
    budget = max(2000, (CONTEXT_WINDOW - 1500) * 3)
    # Generous max_tokens: this is a reasoning model, and its (long) chain of
    # thought counts toward the limit — too small and it runs out before emitting
    # the actual summary, yielding an empty answer.
    if len(text) <= budget:
        return await _complete(client, system, text, model, 1800)

    # Map-reduce for documents larger than the context window.
    partials = []
    for chunk in _chunks(text, budget):
        partials.append(await _complete(client, system, chunk, model, 1200))
    reduce_sys = system + (
        "\nGộp các bản tóm tắt phần dưới đây thành MỘT bản tóm tắt tổng thể mạch lạc."
        if lang == "vi" else
        "\nMerge the partial summaries below into ONE coherent overall summary."
    )
    return await _complete(client, reduce_sys, "\n\n".join(partials), model, 1800)

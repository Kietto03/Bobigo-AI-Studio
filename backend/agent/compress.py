"""Summarize older chat turns into a compact, cumulative memory when context overflows.

The summary is produced once (via a non-streaming LLM call) and the frontend
persists it in place of old turns, so it is not recomputed every request.
Existing memories are preserved and updated incrementally to prevent Context Amnesia.
"""

from __future__ import annotations

from typing import Any

import httpx

from backend.config import DEFAULT_MODEL, LLM_BASE_URL, LLM_TIMEOUT

_INITIAL_SUMMARY_SYSTEM_VI = (
    "Bạn là bộ trích xuất và quản lý bộ nhớ hội thoại thông minh. Hãy chắt lọc đoạn hội thoại dưới đây "
    "thành một BẢN GHI NHỚ NGỮ CẢNH CẤU TRÚC bằng tiếng Việt để mô hình tiếp tục làm việc mà KHÔNG MẤT BẤT KỲ CHI TIẾT NÀO.\n\n"
    "HÃY TỔ CHỨC THEO CÁC MỤC SAU (chỉ dùng gạch đầu dòng, không lời dẫn):\n"
    "1. RÀNG BUỘC & YÊU CẦU CỐT LÕI: phong cách, ngôn ngữ lập trình, thư viện, quy tắc người dùng đặt ra, sở thích.\n"
    "2. DỮ KIỆN & QUYẾT ĐỊNH QUAN TRỌNG: tên riêng, thông số, đường dẫn file, biến số, con số, công nghệ đã chọn.\n"
    "3. TIẾN TRÌNH & TRẠNG THÁI HIỆN TẠI: việc đã làm xong, việc đang dang dở, các câu hỏi/vấn đề đang thảo luận.\n\n"
    "Quy tắc: Giữ nguyên các thuật ngữ, tên biến và số liệu cụ thể. Loại bỏ lời chào hỏi xã giao thừa thãi."
)

_UPDATE_SUMMARY_SYSTEM_VI = (
    "Bạn là bộ quản lý bộ nhớ hội thoại thông minh. Nhiệm vụ của bạn là CẬP NHẬT và TÍCH LŨY bản ghi nhớ "
    "bằng tiếng Việt để mô hình duy trì đầy đủ chi tiết của toàn bộ cuộc trò chuyện từ trước đến nay.\n\n"
    "QUY TẮC BẮT BUỘC:\n"
    "1. BẢO TOÀN toàn bộ dữ kiện cốt lõi từ BẢN GHI NHỚ HIỆN TẠI (quyết định kỹ thuật, tên riêng, yêu cầu người dùng, thông số, trạng thái công việc).\n"
    "2. TÍCH HỢP các diễn biến, quyết định và kết quả mới từ DIỄN BIẾN MỚI.\n"
    "3. TỔ CHỨC RÕ RÀNG theo 3 mục:\n"
    "   - Ràng buộc & Yêu cầu cốt lõi\n"
    "   - Dữ kiện & Quyết định quan trọng\n"
    "   - Tiến trình & Trạng thái hiện tại\n"
    "4. Giữ nguyên số liệu, tên biến, đường dẫn file. Không viết lời dẫn."
)

_INITIAL_SUMMARY_SYSTEM_EN = (
    "You are an intelligent conversation memory manager. Extract and condense the conversation below into "
    "a STRUCTURED CONTEXT MEMORY in English so the model can continue seamlessly WITHOUT LOSING ANY DETAILS.\n\n"
    "ORGANIZE INTO THESE SECTIONS (use bullet points only, no preamble):\n"
    "1. CORE CONSTRAINTS & PREFERENCES: user requirements, style, coding guidelines, libraries, preferences.\n"
    "2. KEY FACTS & DECISIONS: proper names, exact numbers, file paths, variable names, credentials/endpoints, tech choices.\n"
    "3. PROGRESS & CURRENT STATE: completed items, ongoing tasks, pending questions.\n\n"
    "Rule: Preserve exact technical terms, numbers, and identifiers. Eliminate greetings and chit-chat."
)

_UPDATE_SUMMARY_SYSTEM_EN = (
    "You are an intelligent conversation memory manager. Your task is to UPDATE and ACCUMULATE the "
    "conversation memory in English so the model retains full context of the entire conversation.\n\n"
    "STRICT RULES:\n"
    "1. PRESERVE all core facts from the EXISTING MEMORY (technical decisions, proper names, constraints, parameters, ongoing tasks).\n"
    "2. MERGE new events, decisions, and results from the NEW TURNS.\n"
    "3. ORGANIZE CLEARLY into 3 sections:\n"
    "   - Core Constraints & Preferences\n"
    "   - Key Facts & Decisions\n"
    "   - Progress & Current State\n"
    "4. Retain exact numbers, variables, and file paths. Return bullet points with no preamble."
)


def _role_label(role: str, language: str) -> str:
    if language == "en":
        return {"user": "User", "assistant": "Assistant", "tool": "Tool", "system": "System"}.get(role, role)
    return {"user": "Người dùng", "assistant": "Trợ lý", "tool": "Công cụ", "system": "Hệ thống"}.get(role, role)


def is_memory_node(msg: dict[str, Any]) -> bool:
    """Check if a message node represents a previously generated memory note."""
    if not isinstance(msg, dict):
        return False
    if msg.get("summary") is True:
        return True
    content = msg.get("content")
    if isinstance(content, str):
        c = content.strip()
        return c.startswith("[Bản ghi nhớ") or c.startswith("[Memory")
    return False


def extract_existing_memory(messages: list[dict[str, Any]]) -> str:
    """Extract and consolidate text from any existing memory nodes."""
    memories: list[str] = []
    for msg in messages:
        if is_memory_node(msg):
            content = msg.get("content")
            if isinstance(content, str):
                clean = content.strip()
                for prefix in ["[Bản ghi nhớ]\n", "[Bản ghi nhớ]", "[Memory Note]\n", "[Memory Note]"]:
                    if clean.startswith(prefix):
                        clean = clean[len(prefix):].strip()
                if clean and clean not in memories:
                    memories.append(clean)
    return "\n\n".join(memories)


def render_transcript(
    messages: list[dict[str, Any]],
    language: str = "vi",
    max_chars: int = 24_000,
) -> str:
    """Flatten messages into a plain transcript the summarizer can read.

    Caps at 24,000 characters (~6,000-8,000 tokens) so the summarizer request
    comfortably fits inside the 16384 context window with ample room to generate.
    Skips system instructions and existing memory nodes so only actual dialogues are flattened.
    """
    lines: list[str] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if is_memory_node(msg):
            continue
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
    """Return a compact, cumulative memory summary of ``messages``. Raises on LLM/parse errors."""
    lang = "en" if str(language).lower().startswith("en") else "vi"
    existing_memory = extract_existing_memory(messages)
    transcript = render_transcript(messages, lang)

    if not transcript.strip() and not existing_memory.strip():
        return ""

    if existing_memory:
        system = _UPDATE_SUMMARY_SYSTEM_EN if lang == "en" else _UPDATE_SUMMARY_SYSTEM_VI
        if lang == "en":
            user_content = (
                f"--- EXISTING MEMORY ---\n{existing_memory}\n\n"
                f"--- NEW TURNS TO INCORPORATE ---\n{transcript or '(No new turns)'}"
            )
        else:
            user_content = (
                f"--- BẢN GHI NHỚ HIỆN TẠI ---\n{existing_memory}\n\n"
                f"--- CÁC DIỄN BIẾN MỚI CẦN BỔ SUNG ---\n{transcript or '(Không có diễn biến mới)'}"
            )
    else:
        system = _INITIAL_SUMMARY_SYSTEM_EN if lang == "en" else _INITIAL_SUMMARY_SYSTEM_VI
        user_content = transcript

    payload = {
        "model": model or DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.1,
        "max_tokens": 1200,
        "stream": False,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/chat/completions"
    resp = await client.post(url, json=payload, timeout=min(LLM_TIMEOUT, 60))
    resp.raise_for_status()
    data = resp.json()
    msg_obj = (((data.get("choices") or [{}])[0].get("message")) or {})
    content = msg_obj.get("content") or ""
    if not content.strip() and msg_obj.get("reasoning_content"):
        content = msg_obj["reasoning_content"].strip()
    return content.strip()


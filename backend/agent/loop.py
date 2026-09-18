"""Tool-using agent loop over a local OpenAI-compatible llama-server."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Callable
from typing import Any, Awaitable

import httpx

from backend.agent.context import trim_messages
from backend.agent.parse import (
    extract_tool_calls_from_text,
    finalized_tool_calls,
    looks_like_tool_markup,
    merge_tool_call_delta,
    split_think_tags,
    strip_tool_markup,
)
from backend.config import (
    CONTEXT_WINDOW,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    LLM_BASE_URL,
    LLM_TIMEOUT,
    MAX_AGENT_ITERATIONS,
    REPLY_RESERVE,
)
from backend.health import get_active_context_window, get_active_reply_reserve
from backend.tools import execute_tool, tool_schemas
from backend.tools.genfiles import extract_file_markers

log = logging.getLogger(__name__)



def _build_tool_hint(is_en: bool, mcp: Any = None) -> str:
    """Tool hint injected into the system prompt.

    The tool list is derived from the live registry so it never goes stale when
    tools are added. Includes a strict instruction so the (local) model actually
    CALLS the file-generation tools instead of just claiming it made a file.
    """
    names = ", ".join(
        (s.get("function") or {}).get("name", "") for s in tool_schemas(mcp)
    )
    if is_en:
        return (
            f"You have tools: {names}. Call a tool whenever it helps. "
            "When the user asks you to CREATE / GENERATE / EXPORT a file "
            "(markdown, code, CSV, JSON, HTML, SVG, Word .docx, Excel .xlsx …) "
            "you MUST call the matching tool — create_file / create_docx / "
            "create_xlsx — passing the real file content in the arguments. "
            "Never merely say you created a file or show its name in text: if you "
            "did not call the tool, no file exists."
        )
    return (
        f"Bạn có các công cụ: {names}. Hãy gọi tool khi cần. "
        "Khi người dùng yêu cầu TẠO / XUẤT một file (markdown, code, CSV, JSON, "
        "HTML, SVG, Word .docx, Excel .xlsx …) thì BẮT BUỘC phải gọi đúng tool — "
        "create_file / create_docx / create_xlsx — kèm nội dung file thật trong "
        "tham số. Tuyệt đối không chỉ nói 'đã tạo file' hay ghi tên file bằng lời: "
        "nếu bạn không gọi tool thì không có file nào được tạo ra."
    )

LlmStreamer = Callable[[dict[str, Any]], AsyncIterator[dict[str, Any]]]
ToolRunner = Callable[[str, Any], Awaitable[str]]


def sse_pack(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def sse_done() -> str:
    return "data: [DONE]\n\n"


def content_chunk(
    content: str = "",
    reasoning: str = "",
    tool_events: list[dict[str, Any]] | None = None,
    finish_reason: str | None = None,
) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    if reasoning:
        delta["reasoning_content"] = reasoning
    if content:
        delta["content"] = content
    if tool_events:
        delta["tool_events"] = tool_events
    choice: dict[str, Any] = {"index": 0, "delta": delta}
    if finish_reason is not None:
        choice["finish_reason"] = finish_reason
    return {"choices": [choice]}


def prepare_messages(
    messages: list[dict[str, Any]],
    *,
    agent_tools: bool = True,
    mcp: Any = None,
) -> list[dict[str, Any]]:
    system_msgs = [dict(m) for m in messages if m.get("role") == "system"]
    non_system_msgs = [dict(m) for m in messages if m.get("role") != "system"]

    if not system_msgs:
        content = DEFAULT_SYSTEM_PROMPT
        if agent_tools:
            content = (content.rstrip() + "\n\n" + _build_tool_hint(False, mcp)).strip()
        return [{"role": "system", "content": content}] + non_system_msgs

    # The primary system prompt is the first system message
    primary_sys = system_msgs[0]
    sys_body = primary_sys.get("content") or ""
    is_en = "You are" in sys_body or "English" in sys_body or "tools:" in sys_body
    # Append the (dynamic) tool hint whenever it isn't already there — keyed on
    # "create_file" so older prompts that only mention the legacy tools still get
    # the file-generation instruction.
    if agent_tools and "create_file" not in sys_body:
        primary_sys["content"] = (sys_body.rstrip() + "\n\n" + _build_tool_hint(is_en, mcp)).strip()

    # Consolidate any secondary system messages (e.g. memory notes, pinned context)
    # Merging them into the primary system prompt ensures 100% compatibility with all
    # chat templates (avoiding multiple system tags or template errors).
    if len(system_msgs) > 1:
        extra_content = "\n\n".join(
            (m.get("content") or "").strip()
            for m in system_msgs[1:]
            if (m.get("content") or "").strip()
        )
        if extra_content:
            primary_sys["content"] = (primary_sys["content"].rstrip() + "\n\n" + extra_content).strip()

    return [primary_sys] + non_system_msgs


async def default_llm_stream(payload: dict[str, Any], client: httpx.AsyncClient) -> AsyncIterator[dict[str, Any]]:
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/chat/completions"
    async with client.stream("POST", url, json=payload, timeout=LLM_TIMEOUT) as resp:
        resp.raise_for_status()
        buffer = ""
        async for piece in resp.aiter_text():
            buffer += piece
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    return
                try:
                    yield json.loads(data)
                except json.JSONDecodeError:
                    continue


def _parse_arguments(raw: Any) -> Any:
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str):
        return {}
    text = raw.strip() or "{}"
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return raw


async def _run_calls(
    calls: list[dict[str, Any]],
    tool_runner: ToolRunner,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    tool_messages: list[dict[str, Any]] = []
    for call in calls:
        fn = call.get("function") or {}
        name = fn.get("name") or ""
        raw_args = fn.get("arguments")
        result = await tool_runner(name, _parse_arguments(raw_args))
        # File-generation tools embed a hidden marker carrying file metadata.
        # Strip it so the model sees clean text, and surface it as event.files
        # for the UI to render a preview/download card.
        clean, files = extract_file_markers(result)
        event: dict[str, Any] = {
            "id": call.get("id") or "",
            "name": name,
            "arguments": raw_args if isinstance(raw_args, str) else json.dumps(raw_args, ensure_ascii=False),
            "result": clean[:2000],
        }
        if files:
            event["files"] = files
        events.append(event)
        tool_messages.append({
            "role": "tool",
            "tool_call_id": call.get("id") or "",
            "content": clean,
        })
    return events, tool_messages


async def stream_agent(
    body: dict[str, Any],
    *,
    llm_stream: LlmStreamer | None = None,
    tool_runner: ToolRunner | None = None,
    http_client: httpx.AsyncClient | None = None,
    mcp: Any = None,
    should_cancel: Callable[[], Awaitable[bool]] | None = None,
) -> AsyncIterator[str]:
    agent_tools = body.get("agent_tools", True) is not False

    async def _cancelled() -> bool:
        """True when the client went away — checked between iterations/chunks."""
        if should_cancel is None:
            return False
        try:
            return bool(await should_cancel())
        except Exception:  # noqa: BLE001 — a broken checker must not kill the loop
            return False

    messages = prepare_messages(
        list(body.get("messages") or []),
        agent_tools=agent_tools,
        mcp=mcp,
    )
    model = body.get("model") or DEFAULT_MODEL
    runner = tool_runner or (lambda n, a: execute_tool(n, a, http_client, mcp))

    async def _llm(payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        if llm_stream is not None:
            async for item in llm_stream(payload):
                yield item
            return
        if http_client is None:
            raise RuntimeError("http_client is required when llm_stream is omitted")
        async for item in default_llm_stream(payload, http_client):
            yield item

    # Set once we fall back to a tool-less completion (see the retry below).
    tools_disabled = False
    try:
        for iteration in range(MAX_AGENT_ITERATIONS):
            if await _cancelled():
                yield sse_done()
                return
            ctx_window = get_active_context_window()
            default_reserve = get_active_reply_reserve()
            reserve = int(body.get("max_tokens") or default_reserve)
            reserve = max(256, min(reserve, ctx_window - 512))

            acc_calls: dict[int, dict[str, Any]] = {}
            content_parts: list[str] = []
            reasoning_parts: list[str] = []
            finish_reason = None
            forwarded_any = False
            forwarded_content = False
            context_retried = False

            # Stream the model. If llama-server rejects the request:
            # - HTTP 400 (context overflow): emergency prune context and retry once.
            # - HTTP 500 (tool parsing failed): retry without tools so user gets plain-text answer.
            while True:
                use_tools = bool(agent_tools) and not tools_disabled
                payload: dict[str, Any] = {
                    "model": model,
                    "messages": trim_messages(messages, window=ctx_window, reserve=reserve),
                    "temperature": body.get("temperature", 0.7),
                    "top_p": body.get("top_p", 0.9),
                    "stream": True,
                }
                if use_tools:
                    payload["tools"] = tool_schemas(mcp)
                    payload["tool_choice"] = "auto"
                payload["repeat_penalty"] = body.get("repeat_penalty", 1.1)
                if body.get("max_tokens"):
                    payload["max_tokens"] = body["max_tokens"]

                acc_calls = {}
                content_parts = []
                reasoning_parts = []
                finish_reason = None
                forwarded_any = False
                forwarded_content = False
                try:
                    async for event in _llm(payload):
                        if await _cancelled():
                            yield sse_done()
                            return
                        choice = (event.get("choices") or [{}])[0]
                        delta = choice.get("delta") or {}
                        if choice.get("finish_reason"):
                            finish_reason = choice["finish_reason"]
                        msg = choice.get("message") or {}
                        if msg.get("tool_calls"):
                            for i, tc in enumerate(msg["tool_calls"]):
                                merge_tool_call_delta(acc_calls, [{**tc, "index": tc.get("index", i)}])
                        if delta.get("tool_calls"):
                            merge_tool_call_delta(acc_calls, delta["tool_calls"])
                        reasoning = delta.get("reasoning_content") or ""
                        text = delta.get("content") or ""
                        if reasoning:
                            reasoning_parts.append(reasoning)
                            yield sse_pack(content_chunk(reasoning=reasoning))
                            forwarded_any = True
                        if text:
                            content_parts.append(text)
                            assembled = "".join(content_parts)
                            if not looks_like_tool_markup(assembled) and not acc_calls:
                                yield sse_pack(content_chunk(content=text))
                                forwarded_any = True
                                forwarded_content = True
                    break
                except httpx.HTTPStatusError as exc:
                    is_ctx_overflow = (
                        exc.response.status_code == 400
                        and any(k in exc.response.text.lower() for k in ["context", "exceed", "n_ctx", "tokens"])
                    )
                    if is_ctx_overflow and not forwarded_any and not context_retried:
                        context_retried = True
                        log.warning(
                            "Context overflow HTTP 400 from llama-server; emergency pruning context from %d to %d: %s",
                            ctx_window,
                            max(1024, ctx_window // 2),
                            exc.response.text[:200],
                        )
                        ctx_window = max(1024, ctx_window // 2)
                        continue
                    if use_tools and not forwarded_any:
                        tools_disabled = True
                        continue
                    raise
                except httpx.HTTPError:
                    if use_tools and not forwarded_any:
                        tools_disabled = True
                        continue
                    raise

            full_content = "".join(content_parts)
            full_reasoning = "".join(reasoning_parts)
            think, visible = split_think_tags(full_content)
            visible = strip_tool_markup(visible)
            if think and not full_reasoning:
                yield sse_pack(content_chunk(reasoning=think))
                forwarded_any = True

            calls = finalized_tool_calls(acc_calls)
            if not calls:
                calls = extract_tool_calls_from_text(full_content)

            if calls:
                assistant_msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": visible or full_content or None,
                    "tool_calls": calls,
                }
                if full_reasoning or think:
                    assistant_msg["reasoning_content"] = full_reasoning or think
                messages.append(assistant_msg)
                # Don't kick off a long-running tool for a vanished client.
                if await _cancelled():
                    yield sse_done()
                    return
                events, tool_msgs = await _run_calls(calls, runner)
                yield sse_pack(content_chunk(tool_events=events))
                messages.extend(tool_msgs)
                if iteration == MAX_AGENT_ITERATIONS - 1:
                    cap = "Đã đạt giới hạn số vòng gọi công cụ. Hãy thử yêu cầu đơn giản hơn."
                    yield sse_pack(content_chunk(content=cap, finish_reason="stop"))
                    yield sse_done()
                    return
                continue

            if not forwarded_content and (visible or full_content):
                yield sse_pack(content_chunk(content=visible or full_content))
                forwarded_content = True
                forwarded_any = True

            if finish_reason in ("length", "max_tokens"):
                limit_notice = (
                    "\n\n⚠️ *[Đã chạm giới hạn ngữ cảnh (context limit) trong khi suy luận. "
                    "Vui lòng nhấn nút 'Nén hội thoại' hoặc mở cuộc trò chuyện mới để tiếp tục.]*"
                )
                if not forwarded_content:
                    yield sse_pack(content_chunk(content=limit_notice.strip(), finish_reason="stop"))
                else:
                    yield sse_pack(content_chunk(content=limit_notice, finish_reason="stop"))
            elif not forwarded_any:
                yield sse_pack(content_chunk(
                    content="[Không nhận được phản hồi từ mô hình. Vui lòng thử lại hoặc bấm 'Nén hội thoại'.]",
                    finish_reason="stop",
                ))
            else:
                yield sse_pack(content_chunk(finish_reason="stop"))
            yield sse_done()
            return

        yield sse_pack(content_chunk(
            content="Đã đạt giới hạn số vòng gọi công cụ. Hãy thử yêu cầu đơn giản hơn.",
            finish_reason="stop",
        ))
        yield sse_done()
    except httpx.HTTPStatusError as exc:
        msg = str(exc)
        if exc.response.status_code == 400:
            msg = "Yêu cầu vượt quá độ dài ngữ cảnh tối đa (context window). Hãy nhấn 'Nén hội thoại' hoặc mở cuộc trò chuyện mới để tiếp tục."
        yield sse_pack(content_chunk(content=f"Lỗi mô hình ({exc.response.status_code}): {msg}", finish_reason="stop"))
        yield sse_done()
    except httpx.HTTPError as exc:
        yield sse_pack(content_chunk(content=f"Lỗi kết nối mô hình: {exc}", finish_reason="stop"))
        yield sse_done()
    except Exception as exc:
        yield sse_pack(content_chunk(content=f"Lỗi agent: {exc}", finish_reason="stop"))
        yield sse_done()

"""Tool-using agent loop over a local OpenAI-compatible llama-server."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from typing import Any, Awaitable

import httpx

from backend.agent.parse import (
    extract_tool_calls_from_text,
    finalized_tool_calls,
    looks_like_tool_markup,
    merge_tool_call_delta,
    split_think_tags,
    strip_tool_markup,
)
from backend.agent.context import trim_messages
from backend.config import (
    CONTEXT_WINDOW,
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_SYSTEM_PROMPT_EN,
    LLM_BASE_URL,
    LLM_TIMEOUT,
    MAX_AGENT_ITERATIONS,
    REPLY_RESERVE,
)
from backend.roleplay import build_roleplay_system
from backend.tools import execute_tool, tool_schemas

TOOL_HINT = (
    "Bạn có các công cụ: web_search, calculator, code_interpreter, url_reader, "
    "list_files, read_file. Hãy gọi tool khi cần."
)
TOOL_HINT_EN = (
    "You have tools: web_search, calculator, code_interpreter, url_reader, "
    "list_files, read_file. Use them when needed."
)

LlmStreamer = Callable[[dict[str, Any]], AsyncIterator[dict[str, Any]]]
ToolRunner = Callable[[str, Any], Awaitable[str]]


def sse_pack(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def sse_done() -> str:
    return "data: [DONE]\n\n"


def content_chunk(content: str = "", reasoning: str = "", tool_events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    if reasoning:
        delta["reasoning_content"] = reasoning
    if content:
        delta["content"] = content
    if tool_events:
        delta["tool_events"] = tool_events
    return {"choices": [{"index": 0, "delta": delta}]}


def prepare_messages(
    messages: list[dict[str, Any]],
    *,
    mode: str = "chat",
    roleplay: dict[str, Any] | None = None,
    agent_tools: bool = True,
) -> list[dict[str, Any]]:
    prepared = [dict(m) for m in messages if m.get("role") != "system"]
    if mode == "roleplay" and roleplay:
        system = build_roleplay_system(roleplay)
        if agent_tools:
            rp_lang = str(roleplay.get("language") or "vi").lower()
            system = system + "\n\n" + (TOOL_HINT_EN if rp_lang.startswith("en") else TOOL_HINT)
        prepared.insert(0, {"role": "system", "content": system})
        return prepared

    existing_sys = next((dict(m) for m in messages if m.get("role") == "system"), None)
    if existing_sys is None:
        prepared.insert(0, {"role": "system", "content": DEFAULT_SYSTEM_PROMPT})
        return prepared
    sys_body = existing_sys.get("content") or ""
    is_en = "You are" in sys_body or "English" in sys_body or "tools:" in sys_body
    hint = TOOL_HINT_EN if is_en else TOOL_HINT
    if agent_tools and "web_search" not in sys_body and "code_interpreter" not in sys_body:
        existing_sys["content"] = (sys_body.rstrip() + "\n\n" + hint).strip()
    prepared.insert(0, existing_sys)
    return prepared


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
        events.append({
            "id": call.get("id") or "",
            "name": name,
            "arguments": raw_args if isinstance(raw_args, str) else json.dumps(raw_args, ensure_ascii=False),
            "result": result[:2000],
        })
        tool_messages.append({
            "role": "tool",
            "tool_call_id": call.get("id") or "",
            "content": result,
        })
    return events, tool_messages


async def stream_agent(
    body: dict[str, Any],
    *,
    llm_stream: LlmStreamer | None = None,
    tool_runner: ToolRunner | None = None,
    http_client: httpx.AsyncClient | None = None,
    mcp: Any = None,
) -> AsyncIterator[str]:
    agent_tools = body.get("agent_tools", True) is not False
    messages = prepare_messages(
        list(body.get("messages") or []),
        mode=str(body.get("mode") or "chat"),
        roleplay=body.get("roleplay") if isinstance(body.get("roleplay"), dict) else None,
        agent_tools=agent_tools,
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

    try:
        for iteration in range(MAX_AGENT_ITERATIONS):
            reserve = int(body.get("max_tokens") or REPLY_RESERVE)
            payload: dict[str, Any] = {
                "model": model,
                "messages": trim_messages(messages, window=CONTEXT_WINDOW, reserve=reserve),
                "temperature": body.get("temperature", 0.7),
                "top_p": body.get("top_p", 0.9),
                "stream": True,
            }
            if agent_tools:
                payload["tools"] = tool_schemas(mcp)
                payload["tool_choice"] = "auto"
            if body.get("repeat_penalty") is not None:
                payload["repeat_penalty"] = body["repeat_penalty"]
            if body.get("max_tokens"):
                payload["max_tokens"] = body["max_tokens"]

            acc_calls: dict[int, dict[str, Any]] = {}
            content_parts: list[str] = []
            reasoning_parts: list[str] = []
            finish_reason = None
            forwarded_any = False

            async for event in _llm(payload):
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
                events, tool_msgs = await _run_calls(calls, runner)
                yield sse_pack(content_chunk(tool_events=events))
                messages.extend(tool_msgs)
                if iteration == MAX_AGENT_ITERATIONS - 1:
                    cap = "Đã đạt giới hạn số vòng gọi công cụ. Hãy thử yêu cầu đơn giản hơn."
                    yield sse_pack(content_chunk(content=cap))
                    yield sse_done()
                    return
                continue

            if not forwarded_any and (visible or full_content):
                yield sse_pack(content_chunk(content=visible or full_content))
            elif not forwarded_any and finish_reason:
                pass
            yield sse_done()
            return

        yield sse_pack(content_chunk(
            content="Đã đạt giới hạn số vòng gọi công cụ. Hãy thử yêu cầu đơn giản hơn.",
        ))
        yield sse_done()
    except httpx.HTTPError as exc:
        yield sse_pack(content_chunk(content=f"Lỗi kết nối mô hình: {exc}"))
        yield sse_done()
    except Exception as exc:
        yield sse_pack(content_chunk(content=f"Lỗi agent: {exc}"))
        yield sse_done()

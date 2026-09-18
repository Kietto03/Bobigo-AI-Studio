import asyncio
import json

from backend.agent.loop import prepare_messages, stream_agent
from backend.agent.parse import extract_tool_calls_from_text
from backend.config import MAX_AGENT_ITERATIONS


def _collect(body, llm_stream, tool_runner):
    async def _run():
        parts = []
        async for chunk in stream_agent(body, llm_stream=llm_stream, tool_runner=tool_runner):
            parts.append(chunk)
        return "".join(parts)

    return asyncio.run(_run())


def _events(raw: str) -> list[dict]:
    out = []
    for line in raw.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            out.append(json.loads(line[6:]))
    return out


def test_no_tools_streams_content():
    async def llm(_payload):
        yield {"choices": [{"delta": {"content": "xin chào"}}]}
        yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

    async def tools(_n, _a):
        raise AssertionError("tool should not run")

    raw = _collect({"messages": [{"role": "user", "content": "hi"}]}, llm, tools)
    assert "xin chào" in raw
    assert "data: [DONE]" in raw


def test_one_tool_then_answer():
    calls = {"n": 0}

    async def llm(payload):
        if any(m.get("role") == "tool" for m in payload["messages"]):
            yield {"choices": [{"delta": {"content": "kết quả là 4"}}]}
            return
        yield {
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "c1",
                        "function": {"name": "calculator", "arguments": "{\"expression\":\"2+2\"}"},
                    }]
                }
            }]
        }
        yield {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}

    async def tools(name, args):
        calls["n"] += 1
        assert name == "calculator"
        return "4"

    raw = _collect({"messages": [{"role": "user", "content": "2+2?"}]}, llm, tools)
    assert calls["n"] == 1
    assert "kết quả là 4" in raw
    events = _events(raw)
    tool_deltas = [e for e in events if (e.get("choices") or [{}])[0].get("delta", {}).get("tool_events")]
    assert tool_deltas
    assert tool_deltas[0]["choices"][0]["delta"]["tool_events"][0]["name"] == "calculator"


def test_iteration_cap():
    async def llm(_payload):
        yield {
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "c-loop",
                        "function": {"name": "calculator", "arguments": "{\"expression\":\"1\"}"},
                    }]
                }
            }]
        }

    async def tools(_n, _a):
        return "1"

    raw = _collect({"messages": [{"role": "user", "content": "loop"}]}, llm, tools)
    assert "giới hạn" in raw
    assert raw.count("data: [DONE]") == 1
    assert raw.count("calculator") >= MAX_AGENT_ITERATIONS or "giới hạn" in raw


def test_falls_back_to_no_tools_on_http_500():
    # llama-server returns 500 when it can't parse a tool call the local model
    # emitted (e.g. create_file with a huge, invalidly-escaped content arg).
    # The loop must retry the turn without tools so the user still gets an answer.
    import httpx

    async def llm(payload):
        if payload.get("tools"):
            raise httpx.HTTPStatusError(
                "500", request=httpx.Request("POST", "http://x"),
                response=httpx.Response(500),
            )
        for chunk in ["Đây là ", "câu trả lời."]:
            yield {"choices": [{"delta": {"content": chunk}}]}

    async def tools(_n, _a):
        return "unused"

    raw = _collect({"messages": [{"role": "user", "content": "tạo file"}],
                    "agent_tools": True}, llm, tools)
    assert "câu trả lời." in raw
    assert "Lỗi" not in raw
    assert raw.count("data: [DONE]") == 1


def test_prepare_messages_injects_file_tool_instruction():
    from backend.agent.loop import prepare_messages

    # No system message → default prompt + dynamic hint (with agent tools on).
    msgs = prepare_messages([{"role": "user", "content": "tạo file html"}], agent_tools=True)
    sys = msgs[0]["content"]
    assert "create_file" in sys and "create_docx" in sys and "create_xlsx" in sys
    assert "BẮT BUỘC" in sys  # strict: must call the tool, not narrate

    # An older system prompt that only lists legacy tools still gets the hint.
    legacy = [{"role": "system", "content": "Bạn là trợ lý. Có web_search."},
              {"role": "user", "content": "tạo file"}]
    got = prepare_messages(legacy, agent_tools=True)[0]["content"]
    assert "create_file" in got

    # Tools off → no tool hint at all.
    off = prepare_messages([{"role": "user", "content": "x"}], agent_tools=False)
    assert "create_file" not in off[0]["content"]


def test_extract_qwen_xml_tool_call():
    text = '<tool_call>\ncalculator\n```json\n{"expression": "1+1"}\n```\n</tool_call>'
    calls = extract_tool_calls_from_text(text)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "calculator"
    assert "1+1" in calls[0]["function"]["arguments"]


def test_stops_before_second_iteration_when_cancelled():
    """Client disconnect must halt the loop between turns and before new tools."""

    async def main():
        state = {"tool_done": False}

        async def cancel() -> bool:
            # Simulates a client that vanished while the first tool ran.
            return state["tool_done"]

        llm_turns = []
        tool_runs = []

        async def llm(_payload):
            llm_turns.append(1)
            yield {
                "choices": [{
                    "delta": {"tool_calls": [{
                        "index": 0,
                        "id": "c-cancel",
                        "function": {"name": "calculator", "arguments": "{\"expression\":\"1+1\"}"},
                    }]}
                }]
            }
            yield {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}

        async def runner(name, _args):
            tool_runs.append(name)
            state["tool_done"] = True
            return "2"

        parts = []
        async for chunk in stream_agent(
            {"messages": [{"role": "user", "content": "loop"}]},
            llm_stream=llm,
            tool_runner=runner,
            should_cancel=cancel,
        ):
            parts.append(chunk)

        text = "".join(parts)
        assert len(llm_turns) == 1      # second LLM turn never started
        assert tool_runs == ["calculator"]
        assert "[DONE]" in text
        assert "giới hạn" not in text   # clean stop, not a cap message

    asyncio.run(main())


def test_finish_reason_length_during_reasoning_appends_notice():
    """When model halts during reasoning with finish_reason length, append warning notice."""
    async def llm(_payload):
        yield {"choices": [{"delta": {"reasoning_content": "đang suy luận dở dang..."}}]}
        yield {"choices": [{"delta": {}, "finish_reason": "length"}]}

    async def tools(_n, _a):
        pass

    raw = _collect({"messages": [{"role": "user", "content": "câu hỏi dài"}]}, llm, tools)
    events = _events(raw)
    assert any("đang suy luận dở dang..." in (e.get("choices", [{}])[0].get("delta", {}).get("reasoning_content", "")) for e in events)
    # Must contain warning notice in content
    assert any("giới hạn ngữ cảnh" in (e.get("choices", [{}])[0].get("delta", {}).get("content", "")) for e in events)
    assert "data: [DONE]" in raw


def test_finish_reason_length_during_answer_appends_notice():
    """When model halts during answer with finish_reason length, append warning notice."""
    async def llm(_payload):
        yield {"choices": [{"delta": {"content": "đáp án là:"}}]}
        yield {"choices": [{"delta": {}, "finish_reason": "length"}]}

    async def tools(_n, _a):
        pass

    raw = _collect({"messages": [{"role": "user", "content": "câu hỏi dài"}]}, llm, tools)
    events = _events(raw)
    assert any("đáp án là:" in (e.get("choices", [{}])[0].get("delta", {}).get("content", "")) for e in events)
    assert any("giới hạn ngữ cảnh" in (e.get("choices", [{}])[0].get("delta", {}).get("content", "")) for e in events)
    assert "data: [DONE]" in raw


def test_emergency_pruning_on_http_400():
    """When llama-server rejects prompt with HTTP 400 (context overflow), agent prunes and retries."""
    import httpx

    attempt = {"count": 0}

    async def llm(payload):
        attempt["count"] += 1
        if attempt["count"] == 1:
            req = httpx.Request("POST", "http://127.0.0.1:11434/v1/chat/completions")
            resp = httpx.Response(400, request=req, text="request (8762 tokens) exceeds the available context size (8192 tokens)")
            raise httpx.HTTPStatusError("Context overflow", request=req, response=resp)
        # Second attempt succeeds after pruning
        yield {"choices": [{"delta": {"content": "câu trả lời sau khi nén ngữ cảnh"}}]}
        yield {"choices": [{"delta": {}, "finish_reason": "stop"}]}

    async def tools(_n, _a):
        pass

    raw = _collect({"messages": [{"role": "user", "content": "câu hỏi lớn"}]}, llm, tools)
    assert attempt["count"] == 2
    assert "câu trả lời sau khi nén ngữ cảnh" in raw
    assert "data: [DONE]" in raw


def test_prepare_messages_preserves_multiple_system_messages():
    """Verify that memory nodes and secondary system messages are merged rather than dropped."""
    msgs = [
        {"role": "system", "content": "You are Bobigo AI."},
        {"role": "system", "content": "[Memory Note]\n- User prefers TypeScript.\n- Database port is 5433."},
        {"role": "user", "content": "What was the database port?"},
    ]
    prepared = prepare_messages(msgs, agent_tools=True)
    # Must contain 1 primary system message followed by user messages
    assert len(prepared) == 2
    sys_content = prepared[0]["content"]
    assert "You are Bobigo AI." in sys_content
    assert "[Memory Note]" in sys_content
    assert "Database port is 5433" in sys_content
    assert prepared[1]["role"] == "user"


def test_agent_loop_emits_finish_reason_stop():
    """Ensure standard OpenAI clients (Cline, Roo Code) receive finish_reason: stop."""
    async def llm(_payload):
        yield {"choices": [{"delta": {"content": "Xin chào!"}}]}

    async def runner(_name, _args):
        return ""

    raw = _collect({"messages": [{"role": "user", "content": "hi"}]}, llm, runner)
    assert '"finish_reason": "stop"' in raw
    assert "data: [DONE]" in raw


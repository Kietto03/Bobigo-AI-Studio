import asyncio
import json

from backend.agent.loop import stream_agent
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

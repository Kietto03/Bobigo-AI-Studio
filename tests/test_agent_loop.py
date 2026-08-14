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


def test_extract_qwen_xml_tool_call():
    text = '<tool_call>\ncalculator\n```json\n{"expression": "1+1"}\n```\n</tool_call>'
    calls = extract_tool_calls_from_text(text)
    assert len(calls) == 1
    assert calls[0]["function"]["name"] == "calculator"
    assert "1+1" in calls[0]["function"]["arguments"]

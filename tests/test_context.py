from backend.agent.context import estimate_tokens, trim_messages


def test_trim_drops_oldest_and_keeps_system():
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "old " * 2000},
        {"role": "assistant", "content": "old-a " * 2000},
        {"role": "user", "content": "new question"},
        {"role": "assistant", "content": "new answer"},
    ]
    trimmed = trim_messages(messages, window=800, reserve=200)
    roles = [m["role"] for m in trimmed]
    assert roles[0] == "system"
    assert trimmed[-1]["content"] == "new answer"
    assert "old " * 2000 not in [m.get("content") for m in trimmed]


def test_trim_caps_tool_results():
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "read it"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "function": {"name": "read_file"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "X" * 20_000},
    ]
    trimmed = trim_messages(messages, window=8192, reserve=100)
    tool = next(m for m in trimmed if m["role"] == "tool")
    assert len(tool["content"]) < 20_000
    assert "đã cắt" in tool["content"]


def test_estimate_tokens_positive():
    assert estimate_tokens("abcd") >= 1

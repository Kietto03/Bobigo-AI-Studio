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


def test_trim_always_keeps_a_user_message():
    # A long tool/assistant loop that would push the user turn out of budget.
    # The Qwen --jinja template 500s if no user message survives, so trim must
    # always retain the most recent user query.
    messages = [{"role": "system", "content": "sys"},
                {"role": "user", "content": "câu hỏi gốc"}]
    for _ in range(12):
        messages.append({"role": "assistant", "content": "phân tích " * 2000})
    trimmed = trim_messages(messages, window=8192, reserve=2048)
    assert any(m["role"] == "user" for m in trimmed)


def test_trim_reinserts_user_when_only_tool_remains():
    messages = [
        {"role": "user", "content": "làm giúp"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "function": {"name": "read_file"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "Z" * 40_000},
    ]
    trimmed = trim_messages(messages, window=2048, reserve=512)
    assert any(m["role"] == "user" for m in trimmed)


def test_estimate_tokens_positive():
    assert estimate_tokens("abcd") >= 1


def test_vietnamese_token_estimation():
    vi_text = "Hôm nay tôi muốn hỏi về cách tối ưu hoá mô hình trí tuệ nhân tạo."
    ascii_text = "Today I want to ask about optimizing the artificial intelligence model."
    # Vietnamese with diacritics should produce conservative token estimates
    vi_tokens = estimate_tokens(vi_text)
    assert vi_tokens > len(vi_text) // 4


def test_trim_caps_giant_user_message():
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "Rất dài " * 5000},
    ]
    trimmed = trim_messages(messages, window=8192, reserve=2048)
    user_msg = next(m for m in trimmed if m["role"] == "user")
    assert "lược bớt" in user_msg["content"]


def test_trim_preserves_tool_cluster():
    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "câu hỏi cũ " * 500},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "function": {"name": "f1"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "res1"},
        {"role": "assistant", "content": "kết quả 1"},
        {"role": "user", "content": "câu hỏi mới"},
    ]
    trimmed = trim_messages(messages, window=1000, reserve=200)
    # Ensure no orphan tool message survived without its assistant
    for i, m in enumerate(trimmed):
        if m.get("role") == "tool":
            prev = trimmed[i - 1]
            assert prev.get("role") == "assistant"
            assert any(tc.get("id") == m.get("tool_call_id") for tc in (prev.get("tool_calls") or []))


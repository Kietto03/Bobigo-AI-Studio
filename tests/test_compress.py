import asyncio

from fastapi.testclient import TestClient

from backend.agent.compress import render_transcript, summarize_messages
from backend.app import app


class _FakeResp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class _FakeClient:
    """Minimal stand-in for httpx.AsyncClient.post used by the summarizer."""

    def __init__(self, content):
        self._content = content
        self.sent = []

    async def post(self, url, json=None, timeout=None):
        self.sent.append(json)
        return _FakeResp({"choices": [{"message": {"content": self._content}}]})


MESSAGES = [
    {"role": "system", "content": "sys prompt"},
    {"role": "user", "content": "Tên tôi là An, tôi thích màu xanh."},
    {"role": "assistant", "content": "Chào An!"},
    {"role": "user", "content": "Nhớ giúp tôi mua sữa."},
]


def test_render_transcript_skips_system_and_labels_roles():
    out = render_transcript(MESSAGES, "vi")
    assert "sys prompt" not in out
    assert "Người dùng: Tên tôi là An" in out
    assert "Trợ lý: Chào An" in out


def test_render_transcript_english_labels():
    out = render_transcript(MESSAGES, "en")
    assert "User:" in out and "Assistant:" in out


def test_summarize_messages_returns_content():
    client = _FakeClient("- Người dùng tên An, thích màu xanh\n- Cần mua sữa")
    summary = asyncio.run(summarize_messages(MESSAGES, client, language="vi"))
    assert "An" in summary
    # transcript (not the system prompt) is what gets sent as the user turn
    assert "sữa" in client.sent[0]["messages"][1]["content"]


def test_summarize_empty_returns_empty():
    client = _FakeClient("should not be used")
    summary = asyncio.run(summarize_messages([{"role": "system", "content": "x"}], client))
    assert summary == ""


def test_compress_endpoint_validates_missing_messages():
    with TestClient(app) as c:
        r = c.post("/api/compress", json={})
        assert r.status_code == 400


def test_compress_endpoint_keep_recent_leaves_nothing():
    with TestClient(app) as c:
        r = c.post("/api/compress", json={"messages": [{"role": "user", "content": "hi"}], "keep_recent": 5})
        assert r.status_code == 200
        assert r.json()["compressed_count"] == 0


def test_health_exposes_context_window():
    with TestClient(app) as c:
        data = c.get("/api/health").json()
        assert isinstance(data.get("context_window"), int)
        assert isinstance(data.get("reply_reserve"), int)


def test_extract_existing_memory_and_incremental_summarize():
    from backend.agent.compress import extract_existing_memory, is_memory_node

    memory_node = {
        "role": "system",
        "content": "[Bản ghi nhớ]\n- Người dùng tên là An, thích màu xanh",
        "summary": True,
    }
    assert is_memory_node(memory_node) is True
    assert "Người dùng tên là An" in extract_existing_memory([memory_node])

    # Test incremental update
    new_turns = [
        memory_node,
        {"role": "user", "content": "Bây giờ tôi muốn học thêm về Rust."},
        {"role": "assistant", "content": "Rust là ngôn ngữ hệ thống an toàn."},
    ]
    client = _FakeClient("- Người dùng tên An, thích màu xanh\n- Đang học thêm về Rust")
    summary = asyncio.run(summarize_messages(new_turns, client, language="vi"))
    assert "Rust" in summary
    sent_prompt = client.sent[0]["messages"][1]["content"]
    assert "BẢN GHI NHỚ HIỆN TẠI" in sent_prompt
    assert "Người dùng tên là An" in sent_prompt
    assert "Bây giờ tôi muốn học thêm về Rust" in sent_prompt


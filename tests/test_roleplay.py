from backend.agent.loop import prepare_messages
from backend.roleplay import build_roleplay_system, harvest_memory_tags


def test_harvest_memory_tags():
    raw = "Cô ấy gật đầu.\n<<nhớ: Linh sợ bóng tối>>\n«Tiếp tục đi.»"
    clean, facts = harvest_memory_tags(raw)
    assert "Linh sợ bóng tối" in facts
    assert "<<nhớ" not in clean
    assert "Cô ấy gật đầu" in clean


def test_build_includes_character_and_memory():
    prompt = build_roleplay_system({
        "setting": "Quán rượu cảng sương",
        "rules": "Không gore.",
        "userPersona": {"name": "Kai", "description": "thủy thủ"},
        "characters": [{
            "name": "Linh",
            "role": "bạn đồng hành",
            "personality": "thẳng tính",
            "enabled": True,
        }],
        "memory": [{"text": "Kai nợ Linh một ân huệ"}],
        "sceneLog": [{"text": "Họ vừa cập bến"}],
    })
    assert "Quán rượu cảng sương" in prompt
    assert "Linh" in prompt
    assert "Kai nợ Linh" in prompt
    assert "cập bến" in prompt
    assert "<<nhớ" in prompt
    assert "Bobigo" in prompt
    assert "Apple" not in prompt
    assert "Metal" not in prompt


def test_build_structured_setting_english():
    prompt = build_roleplay_system({
        "language": "en",
        "setting": {
            "genre": "Noir",
            "location": "Rainy pier",
            "conflict": "A missing ledger",
        },
        "characters": [{"name": "June", "role": "informant", "enabled": True}],
        "memory": [],
    })
    assert "Reply entirely in English" in prompt
    assert "Noir" in prompt
    assert "Rainy pier" in prompt
    assert "<<remember" in prompt


def test_prepare_messages_roleplay_replaces_system():
    msgs = prepare_messages(
        [
            {"role": "system", "content": "old"},
            {"role": "user", "content": "xin chào"},
        ],
        mode="roleplay",
        roleplay={"setting": "Rừng sương", "characters": [], "memory": []},
        agent_tools=False,
    )
    assert msgs[0]["role"] == "system"
    assert "Rừng sương" in msgs[0]["content"]
    assert msgs[0]["content"] != "old"
    assert msgs[-1]["content"] == "xin chào"
    assert "web_search" not in msgs[0]["content"]

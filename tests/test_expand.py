from backend.expand import extract_json_object, normalize_expand


def test_extract_json_from_fences():
    raw = 'Sure.\n```json\n{"title": "Dock", "characters": [{"name": "Linh"}]}\n```\n'
    data = extract_json_object(raw)
    assert data["title"] == "Dock"
    assert data["characters"][0]["name"] == "Linh"


def test_normalize_expand_fills_setting():
    out = normalize_expand(
        {
            "title": "Cảng sương",
            "setting": {"genre": "fantasy", "location": "quán rượu"},
            "characters": [{"name": "Linh", "personality": "thẳng"}],
            "userPersona": {"name": "Kai"},
        },
        "vi",
    )
    assert out["title"] == "Cảng sương"
    assert out["setting"]["genre"] == "fantasy"
    assert out["setting"]["world"] == ""
    assert out["characters"][0]["name"] == "Linh"
    assert out["userPersona"]["name"] == "Kai"

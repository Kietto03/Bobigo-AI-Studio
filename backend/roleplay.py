"""Build a pinned roleplay system prompt from structured world data."""

from __future__ import annotations

import re
from typing import Any

MEMORY_TAG_RE = re.compile(
    r"<<\s*(?:nhớ|remember)\s*:\s*(.+?)>>",
    re.I | re.DOTALL,
)
MAX_FIELD = 800
MAX_FACTS = 40
MAX_FACT_LEN = 240
MAX_LOG = 16

SETTING_FIELDS = (
    ("genre", "Thể loại", "Genre"),
    ("era", "Thời đại", "Era / period"),
    ("world", "Thế giới / tổng quan", "World overview"),
    ("location", "Địa điểm hiện tại", "Current location"),
    ("atmosphere", "Không khí / tông", "Atmosphere / tone"),
    ("factions", "Phe phái / xã hội", "Factions / society"),
    ("lore", "Lịch sử / lore", "History / lore"),
    ("powerRules", "Luật phép / công nghệ", "Magic / tech rules"),
    ("conflict", "Xung đột / stakes", "Conflict / stakes"),
    ("timeWeather", "Thời gian & thời tiết", "Time & weather"),
    ("sensory", "Chi tiết giác quan", "Sensory details"),
    ("taboos", "Giới hạn nội dung", "Content limits"),
)

CHAR_FIELDS = (
    ("age", "Tuổi", "Age"),
    ("gender", "Giới tính", "Gender"),
    ("appearance", "Ngoại hình", "Appearance"),
    ("personality", "Tính cách", "Personality"),
    ("speech", "Cách nói", "Speech"),
    ("goals", "Mục tiêu", "Goals"),
    ("relationships", "Quan hệ", "Relationships"),
    ("exampleLines", "Ví dụ thoại", "Sample lines"),
    ("notes", "Ghi chú", "Notes"),
)


def _clip(value: Any, limit: int = MAX_FIELD) -> str:
    text = (value if isinstance(value, str) else str(value or "")).strip()
    if len(text) > limit:
        return text[:limit].rstrip() + "…"
    return text


def harvest_memory_tags(text: str) -> tuple[str, list[str]]:
    facts = [m.group(1).strip() for m in MEMORY_TAG_RE.finditer(text or "") if m.group(1).strip()]
    cleaned = MEMORY_TAG_RE.sub("", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, facts


def normalize_setting(raw: Any) -> dict[str, str]:
    empty = {key: "" for key, _vi, _en in SETTING_FIELDS}
    if not raw:
        return empty
    if isinstance(raw, str):
        empty["world"] = raw
        return empty
    if isinstance(raw, dict):
        out = dict(empty)
        for key in empty:
            if raw.get(key):
                out[key] = str(raw[key])
        if raw.get("setting") and not out["world"]:
            out["world"] = str(raw["setting"])
        return out
    return empty


def _lang(world: dict[str, Any]) -> str:
    value = str(world.get("language") or "vi").lower()
    return "en" if value.startswith("en") else "vi"


def _char_block(char: dict[str, Any], lang: str) -> str:
    name = _clip(char.get("name") or ("Unnamed" if lang == "en" else "Không tên"), 80)
    role = _clip(char.get("role") or "npc", 40)
    lines = [f"### {name} ({role})"]
    for key, vi, en in CHAR_FIELDS:
        val = _clip(char.get(key), MAX_FIELD)
        if val:
            lines.append(f"- {en if lang == 'en' else vi}: {val}")
    return "\n".join(lines)


def _setting_block(setting: dict[str, str], lang: str) -> str:
    lines: list[str] = []
    for key, vi, en in SETTING_FIELDS:
        val = _clip(setting.get(key), 1200 if key in {"world", "lore"} else MAX_FIELD)
        if val:
            lines.append(f"- {en if lang == 'en' else vi}: {val}")
    if not lines:
        return (
            "(not described yet — ask what world they want)"
            if lang == "en"
            else "(chưa mô tả — hỏi người chơi muốn chơi thế giới nào)"
        )
    return "\n".join(lines)


def build_roleplay_system(world: dict[str, Any]) -> str:
    lang = _lang(world)
    setting = normalize_setting(world.get("setting"))
    rules = _clip(world.get("rules"), 800)
    persona = world.get("userPersona") or {}
    user_name = _clip(persona.get("name") or ("Player" if lang == "en" else "Người chơi"), 80)
    user_desc = _clip(persona.get("description"), 800)

    chars = [c for c in (world.get("characters") or []) if c.get("enabled", True)]
    empty_cast = (
        "(no characters yet — ask who they want to meet)"
        if lang == "en"
        else "(chưa có nhân vật — hãy hỏi người chơi muốn gặp ai)"
    )
    char_blocks = [_char_block(c, lang) for c in chars] or [empty_cast]

    facts: list[str] = []
    for item in (world.get("memory") or [])[:MAX_FACTS]:
        text = _clip(item.get("text") if isinstance(item, dict) else item, MAX_FACT_LEN)
        if text:
            facts.append(f"- {text}")
    if not facts:
        facts = [
            "- (no pinned memories yet — record important events with <<remember: ...>>)"
            if lang == "en"
            else "- (chưa có ký ức — ghi sự kiện quan trọng bằng <<nhớ: ...>>)"
        ]

    log_lines: list[str] = []
    for item in (world.get("sceneLog") or [])[-MAX_LOG:]:
        text = _clip(item.get("text") if isinstance(item, dict) else item, 280)
        if text:
            log_lines.append(f"- {text}")
    if not log_lines:
        log_block = "- (scene start)" if lang == "en" else "- (bắt đầu cảnh)"
    else:
        log_block = "\n".join(log_lines)

    if lang == "en":
        header = (
            "You are Bobigo, running a multi-character roleplay. Stay in the configured characters. "
            "Do not break frame unless the player writes (OOC: ...). "
            "Keep personality, voice, and this session's memories consistent. "
            "When something new is worth remembering (names, places, promises, relationships, secrets), "
            "add exactly one line <<remember: ...>> — do not repeat facts already in Memory.\n"
            "Reply entirely in English.\n\n"
        )
        rules_default = "Third person or in-character dialogue. Respect the player's limits."
        sections = (
            f"## Setting\n{_setting_block(setting, lang)}\n\n"
            f"## Rules\n{rules or rules_default}\n\n"
            f"## Player\n- Name: {user_name}\n- Description: {user_desc or '(none)'}\n\n"
            "## Characters\n"
            + "\n\n".join(char_blocks)
            + "\n\n## Required memory (do not forget in this session)\n"
            + "\n".join(facts)
            + "\n\n## Recent scene log\n"
            + log_block
        )
    else:
        header = (
            "Bạn là Bobigo, người dẫn roleplay đa nhân vật. Ở lại trong nhân vật đã cấu hình. "
            "Không phá khung trừ khi người chơi viết (OOC: ...). "
            "Giữ nhất quán tính cách, giọng nói và ký ức của phiên này. "
            "Khi có sự kiện mới đáng nhớ (tên, địa điểm, lời hứa, quan hệ, bí mật), "
            "thêm đúng một dòng <<nhớ: ...>> — không lặp lại điều đã có trong Ký ức.\n"
            "Trả lời hoàn toàn bằng tiếng Việt.\n\n"
        )
        rules_default = "Ngôi thứ ba hoặc thoại nhân vật. Tôn trọng giới hạn người chơi."
        sections = (
            f"## Bối cảnh\n{_setting_block(setting, lang)}\n\n"
            f"## Quy tắc\n{rules or rules_default}\n\n"
            f"## Người chơi\n- Tên: {user_name}\n- Mô tả: {user_desc or '(không có)'}\n\n"
            "## Nhân vật\n"
            + "\n\n".join(char_blocks)
            + "\n\n## Ký ức bắt buộc (không được quên trong phiên này)\n"
            + "\n".join(facts)
            + "\n\n## Nhật ký cảnh gần đây\n"
            + log_block
        )
    return header + sections

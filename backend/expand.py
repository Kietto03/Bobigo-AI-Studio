"""Ask the local LLM to expand a short brief into a roleplay world."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from backend.config import DEFAULT_MODEL, LLM_BASE_URL, LLM_TIMEOUT
from backend.roleplay import SETTING_FIELDS, normalize_setting

_EXPAND_SYSTEM_VI = """Bạn là Bobigo. Nhiệm vụ: biến mô tả ngắn thành hồ sơ roleplay JSON hợp lệ.
Chỉ trả về JSON, không markdown, không lời dẫn.
Schema:
{
  "title": "string",
  "rules": "string",
  "userPersona": {"name": "string", "description": "string"},
  "setting": {
    "genre": "", "era": "", "world": "", "location": "", "atmosphere": "",
    "factions": "", "lore": "", "powerRules": "", "conflict": "",
    "timeWeather": "", "sensory": "", "taboos": ""
  },
  "characters": [
    {
      "name": "", "age": "", "gender": "", "role": "",
      "appearance": "", "personality": "", "speech": "",
      "goals": "", "relationships": "", "exampleLines": "", "notes": ""
    }
  ]
}
Tạo 2-4 nhân vật sống động. Điền đủ các mục setting. Tiếng Việt."""

_EXPAND_SYSTEM_EN = """You are Bobigo. Expand a short brief into a valid roleplay JSON profile.
Return JSON only — no markdown, no preamble.
Schema:
{
  "title": "string",
  "rules": "string",
  "userPersona": {"name": "string", "description": "string"},
  "setting": {
    "genre": "", "era": "", "world": "", "location": "", "atmosphere": "",
    "factions": "", "lore": "", "powerRules": "", "conflict": "",
    "timeWeather": "", "sensory": "", "taboos": ""
  },
  "characters": [
    {
      "name": "", "age": "", "gender": "", "role": "",
      "appearance": "", "personality": "", "speech": "",
      "goals": "", "relationships": "", "exampleLines": "", "notes": ""
    }
  ]
}
Create 2-4 vivid characters. Fill every setting field. English."""


def extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I)
        raw = re.sub(r"\s*```$", "", raw)
    start = raw.find("{")
    if start < 0:
        raise ValueError("no JSON object")
    depth = 0
    for i, ch in enumerate(raw[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(raw[start : i + 1])
    raise ValueError("unbalanced JSON")


def normalize_expand(data: dict[str, Any], language: str) -> dict[str, Any]:
    setting = normalize_setting(data.get("setting"))
    chars = []
    for item in data.get("characters") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        chars.append({
            "name": name[:80],
            "age": str(item.get("age") or "")[:40],
            "gender": str(item.get("gender") or "")[:40],
            "role": str(item.get("role") or "npc")[:40],
            "appearance": str(item.get("appearance") or "")[:800],
            "personality": str(item.get("personality") or "")[:800],
            "speech": str(item.get("speech") or "")[:800],
            "goals": str(item.get("goals") or "")[:800],
            "relationships": str(item.get("relationships") or "")[:800],
            "exampleLines": str(item.get("exampleLines") or "")[:800],
            "notes": str(item.get("notes") or "")[:800],
            "enabled": True,
        })
    persona = data.get("userPersona") if isinstance(data.get("userPersona"), dict) else {}
    return {
        "title": str(data.get("title") or ("New scenario" if language == "en" else "Kịch bản mới"))[:120],
        "language": "en" if language == "en" else "vi",
        "rules": str(data.get("rules") or "")[:800],
        "userPersona": {
            "name": str(persona.get("name") or ("I" if language == "en" else "Tôi"))[:80],
            "description": str(persona.get("description") or "")[:800],
        },
        "setting": setting,
        "characters": chars,
    }


async def expand_world(brief: str, language: str, client: httpx.AsyncClient) -> dict[str, Any]:
    lang = "en" if str(language).lower().startswith("en") else "vi"
    system = _EXPAND_SYSTEM_EN if lang == "en" else _EXPAND_SYSTEM_VI
    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": brief.strip()[:2000]},
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
        "stream": False,
    }
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/chat/completions"
    resp = await client.post(url, json=payload, timeout=min(LLM_TIMEOUT, 120))
    resp.raise_for_status()
    data = resp.json()
    content = (((data.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    parsed = extract_json_object(content)
    return normalize_expand(parsed, lang)


# keep SETTING_FIELDS referenced so expand stays aligned
_ = SETTING_FIELDS

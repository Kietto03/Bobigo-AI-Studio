#!/usr/bin/env python3
"""Optional live smoke against a running llama-server (skipped if offline)."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

LLM = "http://127.0.0.1:11434/v1/chat/completions"
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "calculator",
            "description": "Evaluate a math expression.",
            "parameters": {
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
        },
    }
]


def post(payload: dict) -> dict:
    req = urllib.request.Request(
        LLM,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    try:
        with urllib.request.urlopen("http://127.0.0.1:11434/v1/models", timeout=3) as resp:
            models = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"SKIP: llama-server not reachable ({exc})")
        return 0

    model = ((models.get("data") or [{}])[0] or {}).get("id") or "qwen35b-uncensored"
    print(f"LLM ready, model={model}")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Dùng tool calculator khi cần tính toán."},
            {"role": "user", "content": "Tính 2+2 bằng tool calculator."},
        ],
        "tools": TOOLS,
        "tool_choice": "auto",
        "stream": False,
        "temperature": 0,
        "max_tokens": 256,
    }
    try:
        data = post(payload)
    except Exception as exc:
        print(f"FAIL: chat request error: {exc}")
        return 1

    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    tool_calls = message.get("tool_calls") or []
    content = message.get("content") or ""
    print("finish_reason:", choice.get("finish_reason"))
    print("content:", content[:400])
    print("tool_calls:", json.dumps(tool_calls, ensure_ascii=False)[:800])
    if tool_calls or "4" in content:
        print("OK: model responded with a tool call or the answer 4")
        return 0
    print("WARN: no tool_calls and no '4' in content — template/jinja may be missing")
    return 0


if __name__ == "__main__":
    sys.exit(main())

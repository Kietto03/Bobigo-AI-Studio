"""Probe llama-server readiness and whether it was launched with --jinja."""

from __future__ import annotations

import subprocess
from typing import Any

import httpx

from backend.config import DEFAULT_MODEL, LLM_BASE_URL


def _llama_cmdline() -> str:
    try:
        out = subprocess.check_output(
            ["ps", "-ax", "-o", "args="],
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    for line in out.splitlines():
        if "llama-server" in line and "grep" not in line:
            return line
    return ""


def jinja_status() -> tuple[bool | None, str]:
    cmd = _llama_cmdline()
    if not cmd:
        return None, ""
    return ("--jinja" in cmd.split()), cmd


async def probe_llm(client: httpx.AsyncClient) -> dict[str, Any]:
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/models"
    try:
        resp = await client.get(url, timeout=3.0)
        ready = resp.status_code == 200
        model = DEFAULT_MODEL
        if ready:
            data = resp.json()
            items = data.get("data") or []
            if items and isinstance(items[0], dict):
                model = items[0].get("id") or model
        jinja, cmdline = jinja_status()
        if not ready:
            message = "Mô hình chưa sẵn sàng (llama-server chưa đáp ứng)."
        elif jinja is False:
            message = "llama-server đang chạy nhưng thiếu --jinja. Agent tools có thể không gọi được."
        else:
            message = "Sẵn sàng"
        return {
            "ok": ready and jinja is not False,
            "llm_ready": ready,
            "model": model,
            "jinja": jinja,
            "jinja_known": jinja is not None,
            "message": message,
            "llm_base_url": LLM_BASE_URL,
        }
    except httpx.HTTPError:
        jinja, _cmdline = jinja_status()
        return {
            "ok": False,
            "llm_ready": False,
            "model": DEFAULT_MODEL,
            "jinja": jinja,
            "jinja_known": jinja is not None,
            "message": "Không kết nối được llama-server. Đợi model load hoặc chạy ./run.sh.",
            "llm_base_url": LLM_BASE_URL,
        }

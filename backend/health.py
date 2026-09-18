"""Probe llama-server readiness and whether it serves a Jinja chat template.

Jinja detection prefers llama-server's own ``GET /props`` (which includes the
active ``chat_template`` when launched with ``--jinja``) and only falls back to
scanning the process table when the API answer is inconclusive.
"""

from __future__ import annotations

import logging
import subprocess
from typing import Any

import httpx

from backend import __version__
from backend.config import CONTEXT_WINDOW, DEFAULT_MODEL, LLM_BASE_URL, REPLY_RESERVE

log = logging.getLogger(__name__)


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
    """Fallback detection via the process table (macOS/Linux `ps`)."""
    cmd = _llama_cmdline()
    if cmd:
        return ("--jinja" in cmd.split()), cmd
    # Check if mlx_lm or exo is running
    try:
        out = subprocess.check_output(
            ["ps", "-ax", "-o", "args="],
            text=True,
            timeout=2,
        )
        for line in out.splitlines():
            if ("mlx_lm" in line or "exo" in line) and "grep" not in line:
                return True, line
    except (OSError, subprocess.SubprocessError):
        pass
    return None, ""


# Cached active limits detected from llama-server
_ACTIVE_CONTEXT_WINDOW: int = CONTEXT_WINDOW
_ACTIVE_REPLY_RESERVE: int = REPLY_RESERVE


def get_active_context_window() -> int:
    """Return the detected context window from llama-server or fallback to CONTEXT_WINDOW."""
    return _ACTIVE_CONTEXT_WINDOW


def get_active_reply_reserve() -> int:
    """Return the calculated reply reserve token amount."""
    return _ACTIVE_REPLY_RESERVE


async def fetch_llama_props(client: httpx.AsyncClient) -> dict[str, Any] | None:
    """Fetch GET /props from llama-server. Returns parsed JSON or None."""
    try:
        resp = await client.get(f"{LLM_BASE_URL.rstrip('/')}/props", timeout=2.0)
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data if isinstance(data, dict) else None
    except (httpx.HTTPError, ValueError) as exc:  # ValueError: non-JSON body
        log.debug("/props unavailable (%s); falling back to ps scan", exc)
        return None


async def jinja_via_props(client: httpx.AsyncClient) -> bool | None:
    """True/False from GET /props, or None when the API answer is inconclusive.

    llama-server exposes the active chat template on /props only when it was
    launched with --jinja. Older builds may omit the field entirely — in that
    case we report "unknown" and let the caller fall back to `ps`.
    """
    props = await fetch_llama_props(client)
    if not props:
        return None
    template = props.get("chat_template")
    return bool(isinstance(template, str) and template.strip())


async def probe_llm(client: httpx.AsyncClient) -> dict[str, Any]:
    url = f"{LLM_BASE_URL.rstrip('/')}/v1/models"

    async def _payload(*, ready: bool, model: str, message: str) -> dict[str, Any]:
        global _ACTIVE_CONTEXT_WINDOW, _ACTIVE_REPLY_RESERVE
        props = await fetch_llama_props(client) if ready else None

        # Prefer the API answer (/props); fall back to scanning `ps` output.
        jinja = None
        if props is not None:
            template = props.get("chat_template")
            jinja = bool(isinstance(template, str) and template.strip())
        if jinja is None:
            jinja, _cmdline = jinja_status()

        # Dynamic context size detection from llama-server
        n_ctx = None
        if props is not None:
            gen_settings = props.get("default_generation_settings")
            if isinstance(gen_settings, dict):
                val = gen_settings.get("n_ctx")
                if isinstance(val, int) and val > 0:
                    n_ctx = val

        ctx_window = n_ctx or CONTEXT_WINDOW
        reply_reserve = min(REPLY_RESERVE, max(512, ctx_window // 3))

        _ACTIVE_CONTEXT_WINDOW = ctx_window
        _ACTIVE_REPLY_RESERVE = reply_reserve

        return {
            "ok": ready and jinja is not False,
            "llm_ready": ready,
            "model": model,
            "jinja": jinja,
            "jinja_known": jinja is not None,
            "message": message,
            "llm_base_url": LLM_BASE_URL,
            "context_window": ctx_window,
            "reply_reserve": reply_reserve,
            "version": __version__,
        }


    try:
        resp = await client.get(url, timeout=3.0)
        ready = resp.status_code == 200
        model = DEFAULT_MODEL
        if ready:
            data = resp.json()
            items = data.get("data") or []
            if items and isinstance(items[0], dict):
                model = items[0].get("id") or model
        if not ready:
            message = "Mô hình chưa sẵn sàng (llama-server chưa đáp ứng)."
        else:
            message = "Sẵn sàng"
        return await _payload(ready=ready, model=model, message=message)
    except httpx.HTTPError:
        return await _payload(
            ready=False,
            model=DEFAULT_MODEL,
            message="Không kết nối được llama-server. Đợi model load hoặc chạy ./run.sh.",
        )

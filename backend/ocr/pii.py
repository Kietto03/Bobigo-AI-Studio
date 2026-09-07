"""Detect & redact Vietnamese-context PII before display / storage / LLM.

Heuristic regex — good enough to keep obvious identifiers out of the model and
the UI. Numeric categories overlap (a 10-digit string could be a phone or a tax
code); patterns are applied in priority order and each match is masked so later
patterns don't re-match inside it.
"""

from __future__ import annotations

import re
from typing import Any

_ORDER: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("SĐT", re.compile(r"(?<!\w)(?:\+?84|0)(?:3|5|7|8|9)\d{8}(?!\d)")),
    ("Thẻ/STK", re.compile(r"(?<!\d)\d{13,19}(?!\d)")),
    ("CCCD/CMND", re.compile(r"(?<!\d)\d{12}(?!\d)")),
    ("MST", re.compile(r"(?<!\d)\d{10}(?:-\d{3})?(?!\d)")),
]


def detect_and_redact(text: str, mask: bool = True) -> dict[str, Any]:
    counts: dict[str, int] = {}
    redacted = text or ""
    for label, pat in _ORDER:
        def _repl(m: re.Match, _label: str = label) -> str:
            counts[_label] = counts.get(_label, 0) + 1
            return f"[ĐÃ CHE: {_label}]"
        redacted = pat.sub(_repl, redacted)
    entities = [{"type": k, "count": v} for k, v in counts.items()]
    return {
        "redacted": redacted if mask else (text or ""),
        "entities": entities,
        "has_pii": bool(entities),
    }

"""Heuristic document sensitivity classification."""

from __future__ import annotations

from typing import Any

_MEDICAL_HINTS = [
    "chẩn đoán", "xét nghiệm", "bệnh nhân", "hồ sơ bệnh", "huyết áp",
    "medlatec", "đơn thuốc", "kết quả xét nghiệm", "diagnosis", "patient",
]

# public | internal | confidential | restricted
def classify_sensitivity(text: str, entities: list[dict[str, Any]]) -> str:
    types = {e["type"] for e in entities}
    total = sum(e.get("count", 0) for e in entities)
    low = (text or "").lower()
    medical = any(h in low for h in _MEDICAL_HINTS)

    if "CCCD/CMND" in types or medical:
        return "restricted"
    if types & {"Thẻ/STK", "MST"} or total >= 5:
        return "confidential"
    if entities:
        return "internal"
    return "public"

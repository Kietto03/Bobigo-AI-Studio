"""Local OCR via Tesseract (offline — no data leaves the machine)."""

from __future__ import annotations

import io
from typing import Any

from backend.config import TESSERACT_LANGS


def tesseract_available() -> bool:
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def available_langs() -> list[str]:
    try:
        import pytesseract
        return list(pytesseract.get_languages(config=""))
    except Exception:  # noqa: BLE001
        return []


def _normalize_langs(langs: str | None) -> str:
    want = langs or TESSERACT_LANGS
    have = set(available_langs())
    if not have:
        return want
    parts = [p for p in want.split("+") if p in have]
    return "+".join(parts) or ("eng" if "eng" in have else next(iter(have)))


def ocr_image(image: Any, langs: str | None = None) -> str:
    """OCR a PIL image or raw image bytes → text."""
    import pytesseract
    from PIL import Image

    if isinstance(image, (bytes, bytearray)):
        image = Image.open(io.BytesIO(image))
    try:
        return pytesseract.image_to_string(image, lang=_normalize_langs(langs)).strip()
    except Exception:  # noqa: BLE001 — fall back to English if a lang pack is missing
        return pytesseract.image_to_string(image, lang="eng").strip()

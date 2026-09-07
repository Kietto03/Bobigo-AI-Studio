"""OCR & Document Intelligence: extract (Tesseract/MarkItDown) → PII redact →
classify sensitivity → summarize. Fully local / on-prem."""

from __future__ import annotations

from typing import Any

import httpx

from backend.ocr.classify import classify_sensitivity
from backend.ocr.extract import extract_document_text
from backend.ocr.pii import detect_and_redact
from backend.ocr.summarize import summarize_document
from backend.ocr.tesseract import available_langs, tesseract_available

__all__ = [
    "process_document", "extract_document_text", "detect_and_redact",
    "classify_sensitivity", "summarize_document", "tesseract_available", "available_langs",
]


async def process_document(
    data: bytes,
    filename: str,
    client: httpx.AsyncClient,
    *,
    langs: str | None = None,
    redact_pii: bool = True,
    language: str = "vi",
    summarize: bool = True,
) -> dict[str, Any]:
    """Run the full pipeline and return everything the UI/audit needs."""
    extracted = extract_document_text(data, filename, langs)
    text = extracted["text"]
    pii = detect_and_redact(text, mask=redact_pii)
    sensitivity = classify_sensitivity(text, pii["entities"])

    summary = ""
    if summarize and text.strip():
        # Never send raw PII to the model when redaction is on.
        llm_input = pii["redacted"] if redact_pii else text
        summary = await summarize_document(llm_input, client, language=language)

    return {
        "extract": extracted,
        "text": text,
        "redacted_text": pii["redacted"],
        "pii": pii,
        "sensitivity": sensitivity,
        "summary_markdown": summary,
    }

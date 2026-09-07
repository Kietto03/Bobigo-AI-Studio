"""Extract text from ANY document: native formats via MarkItDown, images and
scanned PDFs via Tesseract OCR."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from backend.config import OCR_MAX_PAGES
from backend.ocr.tesseract import ocr_image

_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".webp", ".gif"}


def _markitdown(data: bytes, filename: str) -> str:
    from backend.ocr.cleanup import clean_extracted_markdown
    from backend.tools.markdown_convert import convert_bytes_to_markdown
    return clean_extracted_markdown(convert_bytes_to_markdown(data, filename) or "")


def extract_document_text(
    data: bytes, filename: str, langs: str | None = None, max_pages: int = OCR_MAX_PAGES
) -> dict[str, Any]:
    """Return {text, pages, method, ocr_used}. method ∈ markitdown|ocr|text."""
    ext = Path(filename).suffix.lower()

    # Images → always OCR.
    if ext in _IMAGE_EXT:
        return {"text": ocr_image(data, langs), "pages": 1, "method": "ocr", "ocr_used": True}

    # PDF → prefer the embedded text layer; OCR each page if it looks scanned.
    if ext == ".pdf":
        md = _markitdown(data, filename)
        pages = 0
        try:
            import pypdfium2 as pdfium
            pdf = pdfium.PdfDocument(data)
            pages = len(pdf)
        except Exception:  # noqa: BLE001
            pdf = None
        # Heuristic: too little text for the page count ⇒ scanned.
        if pdf is not None and len(md.strip()) < max(80, pages * 20):
            parts: list[str] = []
            for i in range(min(pages, max_pages)):
                try:
                    pil = pdf[i].render(scale=2.0).to_pil()
                    parts.append(ocr_image(pil, langs))
                except Exception:  # noqa: BLE001
                    continue
            ocr_text = "\n\n".join(p for p in parts if p.strip())
            if len(ocr_text) > len(md.strip()):
                return {"text": ocr_text, "pages": pages, "method": "ocr", "ocr_used": True}
        return {"text": md, "pages": pages or None, "method": "markitdown", "ocr_used": False}

    # Office / HTML / everything else → MarkItDown, then plain-text fallback.
    md = _markitdown(data, filename)
    if md:
        return {"text": md, "pages": None, "method": "markitdown", "ocr_used": False}
    return {
        "text": data.decode("utf-8", errors="replace"),
        "pages": None, "method": "text", "ocr_used": False,
    }

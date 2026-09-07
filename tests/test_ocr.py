"""Tests for the OCR & Document Intelligence pipeline."""

import asyncio
import io

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.ocr import (
    classify_sensitivity,
    detect_and_redact,
    extract_document_text,
    process_document,
)
from backend.ocr.tesseract import tesseract_available


def test_pii_detect_and_redact():
    text = "Liên hệ: an@corp.vn, SĐT 0912345678, CCCD 012345678901."
    r = detect_and_redact(text, mask=True)
    types = {e["type"] for e in r["entities"]}
    assert {"email", "SĐT", "CCCD/CMND"} <= types
    assert "an@corp.vn" not in r["redacted"]
    assert "0912345678" not in r["redacted"]
    assert "[ĐÃ CHE" in r["redacted"]
    assert r["has_pii"] is True


def test_pii_no_mask_still_detects():
    r = detect_and_redact("mail x@y.vn", mask=False)
    assert r["redacted"] == "mail x@y.vn"  # untouched
    assert any(e["type"] == "email" for e in r["entities"])  # but detected


def test_classify_sensitivity_levels():
    _, cccd = None, [{"type": "CCCD/CMND", "count": 1}]
    assert classify_sensitivity("hồ sơ", cccd) == "restricted"
    assert classify_sensitivity("kết quả xét nghiệm bình thường", []) == "restricted"
    assert classify_sensitivity("số thẻ", [{"type": "Thẻ/STK", "count": 1}]) == "confidential"
    assert classify_sensitivity("email", [{"type": "email", "count": 1}]) == "internal"
    assert classify_sensitivity("tài liệu công khai", []) == "public"


def test_extract_html_uses_markitdown_not_ocr():
    try:
        import markitdown  # noqa: F401
    except Exception:
        pytest.skip("markitdown not installed")
    html = b"<h1>Bao cao</h1><p>noi dung</p>"
    r = extract_document_text(html, "doc.html")
    assert r["ocr_used"] is False
    assert r["method"] == "markitdown"
    assert "Bao cao" in r["text"]


def test_extract_image_uses_ocr():
    if not tesseract_available():
        pytest.skip("tesseract not installed")
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (400, 90), "white")
    ImageDraw.Draw(img).text((10, 30), "HELLO WORLD 12345", fill="black")
    buf = io.BytesIO(); img.save(buf, format="PNG")
    r = extract_document_text(buf.getvalue(), "scan.png")
    assert r["ocr_used"] is True and r["method"] == "ocr"
    assert "HELLO" in r["text"].upper()


def test_process_document_redacts_before_summary_without_llm():
    # summarize=False avoids any LLM dependency; client is unused then.
    text_bytes = "Ho ten A, email a@b.vn, SDT 0987654321".encode("utf-8")
    r = asyncio.run(process_document(text_bytes, "note.txt", client=None,
                                     redact_pii=True, summarize=False))
    assert "[ĐÃ CHE" in r["redacted_text"]
    assert r["summary_markdown"] == ""
    assert r["sensitivity"] in {"internal", "confidential", "restricted"}


def test_cleanup_flattens_fragmented_cover_keeps_real_tables():
    from backend.ocr.cleanup import clean_extracted_markdown

    cover = (
        "| BÁO | CÁO | NGHIÊN | CỨU |\n| --- | --- | --- | --- |\n"
        "| Người thực | hiện: | Dương | Công Thuyết |\n------- | --- | -----"
    )
    out = clean_extracted_markdown(cover)
    assert "BÁO CÁO NGHIÊN CỨU" in out          # re-joined into text
    assert "-------" not in out                  # orphan rule dropped
    assert "|" not in out.split("\n")[0]         # no longer a table row

    data = ("| Sản phẩm | Giá | Số lượng |\n| --- | --- | --- |\n"
            "| Laptop XPS | 45000000 | 3 |")
    kept = clean_extracted_markdown(data)
    assert "| Sản phẩm |" in kept                # numeric table preserved


def test_safe_name_transliterates_vietnamese():
    from backend.tools.genfiles import _safe_name
    got = _safe_name("Báo cáo đối sánh giải pháp AI.md")
    assert "B-o" not in got and "c-o" not in got
    assert got.lower().startswith("bao_cao_doi_sanh")
    assert got.endswith(".md")


def test_ocr_endpoint_requires_multipart():
    with TestClient(app) as client:
        assert client.post("/api/ocr/process", json={}).status_code == 400


def test_audit_endpoint_returns_list():
    with TestClient(app) as client:
        data = client.get("/api/audit").json()
        assert "items" in data and isinstance(data["items"], list)

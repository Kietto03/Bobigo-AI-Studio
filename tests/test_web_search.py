from pathlib import Path

from backend.tools.web_search import parse_ddg_html


def test_parse_ddg_html_fixture():
    html = (Path(__file__).parent / "fixtures" / "ddg_sample.html").read_text(encoding="utf-8")
    results = parse_ddg_html(html, max_results=5)
    assert len(results) == 2
    assert results[0]["title"] == "Example Title"
    assert results[0]["url"] == "https://example.com/page"
    assert "example snippet" in results[0]["snippet"].lower()
    assert results[1]["title"] == "Python Docs"
    assert results[1]["url"] == "https://docs.python.org/3/"


def test_parse_ddg_html_respects_cap():
    html = (Path(__file__).parent / "fixtures" / "ddg_sample.html").read_text(encoding="utf-8")
    assert len(parse_ddg_html(html, max_results=1)) == 1

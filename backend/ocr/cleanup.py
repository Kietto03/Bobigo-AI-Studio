"""Post-process extracted Markdown to undo layout-parsing artifacts.

Complex cover pages / multi-column layouts make MarkItDown (and PDF/OCR parsers)
emit a giant "table" where each whitespace gap becomes a column — so a title like
"BÁO CÁO NGHIÊN CỨU" arrives as `BÁO | CÁO | NGHIÊN | CỨU`, interleaved with
orphan separator rows (`--- | --- | ---`). This flattens such degenerate tables
back into normal text and drops the orphan rules, while leaving genuine data
tables intact.
"""

from __future__ import annotations

import re

_SEP_CELL = re.compile(r"^:?-{2,}:?$")
_SEP_ONLY_LINE = re.compile(r"^[\s\-|:]+$")


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_separator_row(cells: list[str]) -> bool:
    return bool(cells) and all(c == "" or _SEP_CELL.match(c) for c in cells)


def _process_table_block(block: list[str]) -> list[str]:
    rows: list[list[str]] = []
    for line in block:
        cells = _split_row(line)
        if _is_separator_row(cells):
            continue
        cells = [c for c in cells if c]
        if cells:
            rows.append(cells)
    if not rows:
        return []

    cells_flat = [c for r in rows for c in r]
    total_cells = len(cells_flat)
    avg_words = sum(len(c.split()) for c in cells_flat) / max(total_cells, 1)
    single_word_frac = sum(1 for c in cells_flat if len(c.split()) == 1) / max(total_cells, 1)
    # A purely-numeric cell is a strong sign of a real data table (values).
    has_numeric = any(re.fullmatch(r"\d[\d.,]*", c) for c in cells_flat)
    max_cols = max(len(r) for r in rows)

    # Fragmented cover/multi-column layout misread as a table (cells are mostly
    # lone words that belong together, no numeric values) ⇒ rejoin each row into
    # a line of text. Real data tables (with numbers) are left intact.
    fragmented = (
        not has_numeric
        and max_cols >= 3
        and (single_word_frac >= 0.6 or avg_words <= 1.5)
    )
    if fragmented:
        return [" ".join(r).strip() for r in rows if any(r)]

    # Looks like a genuine table — keep it, but with one clean separator row.
    header = "| " + " | ".join(rows[0]) + " |"
    sep = "| " + " | ".join(["---"] * len(rows[0])) + " |"
    body = ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return [header, sep, *body]


def clean_extracted_markdown(text: str) -> str:
    if not text:
        return text
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        if "|" in lines[i]:
            j = i
            while j < n and "|" in lines[j]:
                j += 1
            out.extend(_process_table_block(lines[i:j]))
            i = j
            continue
        stripped = lines[i].strip()
        # Drop orphan markdown table rules left outside any table.
        if stripped and _SEP_ONLY_LINE.match(stripped) and stripped.count("-") >= 3 and "|" in stripped:
            i += 1
            continue
        out.append(lines[i])
        i += 1

    # Collapse 3+ blank lines the flattening may leave behind.
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()

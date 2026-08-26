import { afterEach, describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown } from "../../web/js/markdown.js";

afterEach(() => {
  delete globalThis.marked;
  delete globalThis.DOMPurify;
});

describe("escapeHtml", () => {
  it("escapes all dangerous characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt;&amp;"
    );
  });

  it("passes safe text through unchanged", () => {
    expect(escapeHtml("Xin chào 100%")).toBe("Xin chào 100%");
  });

  it("coerces nullish to empty string", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("renderMarkdown fail-closed behaviour", () => {
  it("returns escaped plain text when DOMPurify is missing (never raw HTML)", () => {
    globalThis.marked = { parse: () => `<img src=x onerror="alert(1)">` };
    const out = renderMarkdown(`<img src=x onerror="alert(1)">`);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("returns escaped plain text when marked is missing", () => {
    globalThis.DOMPurify = { sanitize: (h) => h };
    const out = renderMarkdown("<h1>tiêu đề</h1>");
    expect(out).toContain("&lt;h1&gt;");
  });

  it("sanitizes parser output when both libraries exist", () => {
    globalThis.marked = { parse: (t) => `<p>${t}</p><script>alert(1)</script>` };
    globalThis.DOMPurify = {
      sanitize: (html) => html.replace(/<script>[\s\S]*?<\/script>/g, ""),
    };
    const out = renderMarkdown("xin chào");
    expect(out).toContain("<p>xin chào</p>");
    expect(out).not.toContain("<script>");
  });
});

/**
 * Markdown rendering + HTML escaping.
 * Pure helpers — rely only on the global `marked` / `DOMPurify` libraries.
 */

export function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, function (m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m];
  });
}

export function renderMarkdown(text) {
  // Fail closed: model output is untrusted. If either the parser or the
  // sanitizer is unavailable (e.g. vendor assets not fetched yet), degrade
  // to plain escaped text instead of ever emitting raw HTML.
  if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
    return escapeHtml(text);
  }
  const html = marked.parse(text || "");
  return DOMPurify.sanitize(html);
}

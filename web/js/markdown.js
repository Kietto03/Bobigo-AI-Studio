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
    if (typeof marked === "undefined") {
        return escapeHtml(text);
    }
    const html = marked.parse(text || "");
    if (typeof DOMPurify !== "undefined") {
        return DOMPurify.sanitize(html);
    }
    return html;
}

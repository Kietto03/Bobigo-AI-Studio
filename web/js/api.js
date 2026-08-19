/**
 * Backend endpoints and thin fetch wrappers.
 */

export const API_URL = "/v1/chat/completions";
export const HEALTH_URL = "/api/health";
export const SEARCH_URL = "/api/websearch";
export const COMPRESS_URL = "/api/compress";
export const TOOLS_URL = "/api/tools";

export async function performWebSearch(query, signal) {
    try {
        const res = await fetch(SEARCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: query, max_results: 5 }),
            signal,
        });
        if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        if (e && e.name === "AbortError") throw e;
        console.error("Web search error:", e);
        return [];
    }
}

/**
 * Ask the backend to summarize older turns into a compact memory.
 * Returns { summary, compressed_count }.
 */
export async function postCompress(messages, opts = {}) {
    const { keepRecent = 0, language = "vi", model } = opts;
    const res = await fetch(COMPRESS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, keep_recent: keepRecent, language, model }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/** Fetch the tool + MCP catalog for the Tools panel. Returns {} on failure. */
export async function getToolsCatalog() {
    try {
        const res = await fetch(TOOLS_URL, { cache: "no-store" });
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        return {};
    }
}

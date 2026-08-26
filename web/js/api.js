/**
 * Backend endpoints and thin fetch wrappers.
 */

export const API_URL = "/v1/chat/completions";
export const HEALTH_URL = "/api/health";
export const SEARCH_URL = "/api/websearch";
export const COMPRESS_URL = "/api/compress";
export const TOOLS_URL = "/api/tools";
export const TOKENIZE_URL = "/api/tokenize";

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

/**
 * Exact token count from llama-server's tokenizer. Resolves to
 * { count, exact } — with exact:false when the backend fell back to its
 * len/4 heuristic (LLM unreachable). Returns null on any transport error.
 */
export async function postTokenize(text) {
    try {
        const res = await fetch(TOKENIZE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

/**
 * Durable best-effort write of ONE chat message to the server store.
 * Fire-and-forget: resolves to {ok,seq} / null — never throws. The debounced
 * bulk PUT remains the source of truth; this just makes a freshly streamed
 * message survive a crash/reload even before the next full sync happens.
 * Server returns 201; a 409/400 means the session doesn't exist yet (the
 * bulk PUT will create it) — safe to ignore.
 */
export function postSessionMessage(sessionId, message) {
    return fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
    })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
}

/**
 * Token estimation — calibrated for LLMs (Qwen/Llama BPE tokenizers).
 * Includes non-ASCII/Vietnamese syllable awareness and per-message exact caching
 * to prevent meter jumping (jitter) between heuristic and exact tokenizer passes.
 */

const _tokenCache = new WeakMap();

export function setMessageCachedTokens(msg, tokens) {
    if (msg && typeof msg === "object" && typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0) {
        _tokenCache.set(msg, Math.round(tokens));
    }
}

export function estimateTokens(text) {
    const s = typeof text === "string" ? text : "";
    if (!s) return 0;
    let nonAscii = 0;
    for (let i = 0; i < s.length; i++) {
        if (s.charCodeAt(i) >= 128) nonAscii++;
    }
    const asciiLen = s.length - nonAscii;
    if (nonAscii === 0) {
        return Math.max(1, Math.ceil((asciiLen + 3) / 4));
    }
    const est = Math.ceil((asciiLen + 3) / 4) + Math.ceil(nonAscii * 0.85);
    return Math.max(1, est);
}

export function messageTokens(msg) {
    if (!msg || typeof msg !== "object") return 8;
    if (_tokenCache.has(msg)) {
        return _tokenCache.get(msg);
    }
    // Only count content and tool payloads that are actually sent to the model.
    // Assistant internal reasoning scratchpad is not re-sent in conversation history.
    let blob = typeof msg.content === "string" ? msg.content : "";
    if (Array.isArray(msg.toolEvents)) {
        for (const e of msg.toolEvents) blob += (e.result || "") + (e.arguments || "");
    }
    return estimateTokens(blob) + 8;
}

export function conversationTokens(messages, systemPrompt) {
    let total = systemPrompt ? estimateTokens(systemPrompt) + 8 : 0;
    for (const m of messages || []) total += messageTokens(m);
    return total;
}

export function calculateTokenBreakdown(messages, systemPrompt) {
    const sysTokens = systemPrompt ? estimateTokens(systemPrompt) + 8 : 0;
    let totalMsgTokens = 0;
    let toolAttachTokens = 0;

    for (const m of messages || []) {
        if (!m) continue;
        let attachBlob = "";
        if (Array.isArray(m.toolEvents)) {
            for (const e of m.toolEvents) attachBlob += (e.result || "") + (e.arguments || "");
        }
        if (m.attachments && Array.isArray(m.attachments)) {
            for (const a of m.attachments) attachBlob += (a.text || "");
        }
        if (attachBlob) {
            toolAttachTokens += estimateTokens(attachBlob);
        }
        totalMsgTokens += messageTokens(m);
    }

    const pureChat = Math.max(0, totalMsgTokens - toolAttachTokens);
    return {
        system: sysTokens,
        chat: pureChat,
        tools: toolAttachTokens,
        total: sysTokens + totalMsgTokens,
    };
}


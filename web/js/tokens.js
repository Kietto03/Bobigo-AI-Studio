/**
 * Token estimation — mirrors backend/agent/context.py:estimate_tokens (len/4)
 * so the meter matches what the server actually budgets.
 */

export function estimateTokens(text) {
    const s = typeof text === "string" ? text : "";
    if (!s) return 0;
    return Math.max(1, Math.ceil((s.length + 3) / 4));
}

export function messageTokens(msg) {
    let blob = typeof msg.content === "string" ? msg.content : "";
    if (msg.reasoning) blob += msg.reasoning;
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

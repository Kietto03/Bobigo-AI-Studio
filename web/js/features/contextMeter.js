/**
 * Context-window usage meter shown above the composer.
 * Pure view: main.js feeds it messages + budget and it paints the bar.
 * `applyExact(count)` lets an async tokenizer refine the heuristic estimate.
 */

import { conversationTokens } from "../tokens.js";

export function initContextMeter({ fill, text, root, getBudget }) {
    function paint(used, exact = false) {
        const budget = Math.max(512, getBudget());
        const pct = Math.min(100, Math.round((used / budget) * 100));
        if (fill) fill.style.width = pct + "%";
        let state = "ok";
        if (pct >= 100) state = "over";
        else if (pct >= 85) state = "warn";
        if (root) {
            root.classList.remove("ctx-ok", "ctx-warn", "ctx-over");
            root.classList.add("ctx-" + state);
            root.title = `${Math.round(used).toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%${exact ? " · exact" : ""})`;
        }
        if (text) text.textContent = `${pct}%`;
        return { used: Math.round(used), budget, pct, state };
    }

    function update(messages, systemPrompt) {
        return paint(conversationTokens(messages, systemPrompt), false);
    }

    /** Repaint from a real tokenizer count (+8% headroom for message framing). */
    function applyExact(count) {
        if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
        return paint(count * 1.08, true);
    }

    return { update, applyExact };
}

/**
 * Context-window usage meter shown above the composer.
 * Pure view: main.js feeds it messages + budget and it paints the bar.
 */

import { conversationTokens } from "../tokens.js";

export function initContextMeter({ fill, text, root, getBudget }) {
    function update(messages, systemPrompt) {
        const used = conversationTokens(messages, systemPrompt);
        const budget = Math.max(512, getBudget());
        const pct = Math.min(100, Math.round((used / budget) * 100));
        if (fill) fill.style.width = pct + "%";
        let state = "ok";
        if (pct >= 100) state = "over";
        else if (pct >= 85) state = "warn";
        if (root) {
            root.classList.remove("ctx-ok", "ctx-warn", "ctx-over");
            root.classList.add("ctx-" + state);
            root.title = `${used.toLocaleString()} / ${budget.toLocaleString()} tokens (${pct}%)`;
        }
        if (text) text.textContent = `${pct}%`;
        return { used, budget, pct, state };
    }
    return { update };
}

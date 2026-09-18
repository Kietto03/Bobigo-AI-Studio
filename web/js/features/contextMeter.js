/**
 * Context-window usage meter shown in the composer dock.
 * Supports smooth state indicators (ok, warn, over), interactive breakdown popover,
 * anti-jitter token formatting, and seamless compression trigger.
 */

import { calculateTokenBreakdown, conversationTokens } from "../tokens.js";

export function initContextMeter({
    fill,
    text,
    root,
    getBudget,
    popover,
    compressBtn,
    onCompress,
}) {
    let lastUsed = 0;
    let lastBudget = 6144;
    let lastBreakdown = { system: 0, chat: 0, tools: 0, total: 0 };
    let isCompressing = false;

    // Popover sub-elements if available
    const popoverTotal = popover?.querySelector("#ctx-popover-total");
    const popoverSys = popover?.querySelector("#ctx-popover-sys");
    const popoverChat = popover?.querySelector("#ctx-popover-chat");
    const popoverTools = popover?.querySelector("#ctx-popover-tools");
    const popoverReserve = popover?.querySelector("#ctx-popover-reserve");
    const popoverActionBtn = popover?.querySelector("#ctx-popover-compress-btn");

    function formatNumber(num) {
        return Math.round(num).toLocaleString();
    }

    function formatCompact(num) {
        if (num >= 1000) {
            return (num / 1000).toFixed(1).replace(/\.0$/, "") + "k";
        }
        return String(Math.round(num));
    }

    function updatePopoverDOM(used, budget, pct) {
        if (!popover) return;
        if (popoverTotal) {
            popoverTotal.textContent = `${formatNumber(used)} / ${formatNumber(budget)} (${pct}%)`;
        }
        if (popoverSys) {
            popoverSys.textContent = `${formatNumber(lastBreakdown.system)} tokens`;
        }
        if (popoverChat) {
            popoverChat.textContent = `${formatNumber(lastBreakdown.chat)} tokens`;
        }
        if (popoverTools) {
            popoverTools.textContent = `${formatNumber(lastBreakdown.tools)} tokens`;
        }
        if (popoverReserve) {
            const reserveEst = Math.max(0, budget - used);
            popoverReserve.textContent = `${formatNumber(reserveEst)} tokens còn trống`;
        }
    }

    function paint(used, exact = false) {
        const budget = Math.max(512, typeof getBudget === "function" ? getBudget() : 6144);
        lastUsed = used;
        lastBudget = budget;
        const pct = Math.min(100, Math.round((used / budget) * 100));

        if (fill) {
            fill.style.width = pct + "%";
        }

        let state = "ok";
        if (pct >= 90) state = "over";
        else if (pct >= 75) state = "warn";

        if (root) {
            root.classList.remove("ctx-ok", "ctx-warn", "ctx-over");
            root.classList.add("ctx-" + state);
            root.setAttribute("data-state", state);
            root.title = `${formatNumber(used)} / ${formatNumber(budget)} tokens (${pct}%${exact ? " · exact" : ""})`;
        }

        if (text) {
            text.textContent = `${pct}%`;
            text.setAttribute("data-tokens", `${formatCompact(used)}/${formatCompact(budget)}`);
        }

        updatePopoverDOM(used, budget, pct);

        return { used: Math.round(used), budget, pct, state, breakdown: lastBreakdown };
    }

    function update(messages, systemPrompt) {
        lastBreakdown = calculateTokenBreakdown(messages, systemPrompt);
        const est = conversationTokens(messages, systemPrompt);
        return paint(est, false);
    }

    /** Repaint from a real tokenizer count (+8% headroom for message framing). */
    function applyExact(count) {
        if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
        return paint(count * 1.08, true);
    }

    function setCompressing(compressing) {
        isCompressing = Boolean(compressing);
        if (root) {
            root.classList.toggle("is-compressing", isCompressing);
        }
        if (compressBtn) {
            compressBtn.disabled = isCompressing;
            compressBtn.classList.toggle("is-loading", isCompressing);
        }
        if (popoverActionBtn) {
            popoverActionBtn.disabled = isCompressing;
            popoverActionBtn.classList.toggle("is-loading", isCompressing);
        }
    }

    function togglePopover(show) {
        if (!popover) return;
        const willShow = show !== undefined ? Boolean(show) : popover.classList.contains("hidden");
        popover.classList.toggle("hidden", !willShow);
        if (root) root.classList.toggle("popover-open", willShow);
    }

    if (root && popover) {
        root.addEventListener("click", (e) => {
            if (e.target.closest(".ctx-compress-btn")) return;
            e.stopPropagation();
            togglePopover();
        });

        document.addEventListener("click", (e) => {
            if (!popover.classList.contains("hidden") && !popover.contains(e.target) && !root.contains(e.target)) {
                togglePopover(false);
            }
        });
    }

    const handleCompressClick = (e) => {
        e.stopPropagation();
        if (typeof onCompress === "function" && !isCompressing) {
            onCompress();
        }
    };

    if (compressBtn) {
        compressBtn.addEventListener("click", handleCompressClick);
    }
    if (popoverActionBtn) {
        popoverActionBtn.addEventListener("click", handleCompressClick);
    }

    return {
        update,
        applyExact,
        setCompressing,
        togglePopover,
        getDetails: () => ({
            used: Math.round(lastUsed),
            budget: lastBudget,
            pct: Math.min(100, Math.round((lastUsed / lastBudget) * 100)),
            breakdown: lastBreakdown,
        }),
    };
}


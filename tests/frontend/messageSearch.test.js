// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { initMessageSearch } from "../../web/js/features/messageSearch.js";

function row(text, pinned = false) {
    const div = document.createElement("div");
    div.className = "message-row" + (pinned ? " pinned" : "");
    div.innerText = text;
    container.appendChild(div);
    return div;
}

let container, input, countEl, search;

beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    input = document.createElement("input");
    countEl = document.createElement("span");
    document.body.append(container, input, countEl);
    search = initMessageSearch({ container, input, countEl });
});

describe("initMessageSearch", () => {
    it("highlights matching rows and reports the hit count", () => {
        const a = row("giá vàng hôm nay tăng");
        const b = row("thời tiết Sài Gòn");
        row("giá bạc giảm");
        input.value = "giá";
        search.run();
        expect(a.classList.contains("search-hit")).toBe(true);
        expect(b.classList.contains("search-hit")).toBe(false);
        expect(countEl.textContent).toMatch(/^1\/2$/);
    });

    it("next() wraps around hits", () => {
        const first = row("alpha one");
        const second = row("alpha two");
        input.value = "alpha";
        search.run();
        expect(first.classList.contains("search-current")).toBe(true);
        search.next(1);
        expect(second.classList.contains("search-current")).toBe(true);
        search.next(1); // wraps back
        expect(first.classList.contains("search-current")).toBe(true);
    });

    it("pinned-only filter matches without a query", () => {
        const pinnedRow = row("ghi nhớ cái này", true);
        row("bình thường", false);
        const isPinnedOnly = search.togglePinned();
        expect(isPinnedOnly).toBe(true);
        expect(pinnedRow.classList.contains("search-hit")).toBe(true);
        const others = container.querySelectorAll(".search-hit");
        expect(others.length).toBe(1);
    });

    it("clear() removes all marks", () => {
        row("tìm tôi");
        input.value = "tìm";
        search.run();
        search.clear();
        expect(container.querySelectorAll(".search-hit").length).toBe(0);
        expect(countEl.textContent).toBe("");
    });
});

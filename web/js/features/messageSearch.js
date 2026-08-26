/**
 * In-conversation search over the rendered message DOM.
 * Highlights matching rows, supports next/prev navigation and a
 * "pinned only" filter. Operates on `.message-row` elements in the container.
 */

export function initMessageSearch({ container, input, countEl }) {
    let hits = [];
    let cur = -1;
    let pinnedOnly = false;

    function clearMarks() {
        container.querySelectorAll(".search-hit, .search-current").forEach((el) => {
            el.classList.remove("search-hit", "search-current");
        });
        hits = [];
        cur = -1;
        if (countEl) countEl.textContent = "";
    }

    function focus() {
        hits.forEach((h) => h.classList.remove("search-current"));
        const el = hits[cur];
        if (!el) return;
        el.classList.add("search-current");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        if (countEl) countEl.textContent = `${cur + 1}/${hits.length}`;
    }

    function run() {
        clearMarks();
        const q = (input.value || "").trim().toLowerCase();
        const rows = Array.from(container.querySelectorAll(".message-row"));
        for (const row of rows) {
            if (pinnedOnly && !row.classList.contains("pinned")) continue;
            const text = (row.innerText || "").toLowerCase();
            if (q ? text.includes(q) : pinnedOnly) {
                row.classList.add("search-hit");
                hits.push(row);
            }
        }
        if (hits.length) {
            cur = 0;
            focus();
        } else if (countEl) {
            countEl.textContent = q || pinnedOnly ? "0" : "";
        }
    }

    function next(dir) {
        if (!hits.length) return;
        cur = (cur + dir + hits.length) % hits.length;
        focus();
    }

    function togglePinned() {
        pinnedOnly = !pinnedOnly;
        run();
        return pinnedOnly;
    }

    return { run, next, togglePinned, clear: clearMarks };
}

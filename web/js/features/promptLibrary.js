/**
 * Prompt library: reusable system-prompt presets + slash quick-commands.
 * Presets persist in localStorage; slash commands combine built-ins with
 * user-saved snippets and appear in a popover when the composer starts with "/".
 */

const PRESET_KEY = "bobigo_prompt_presets";
const SNIPPET_KEY = "bobigo_prompt_snippets";

function readJSON(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return Array.isArray(v) ? v : fallback;
    } catch (e) {
        return fallback;
    }
}

export function loadPresets() {
    return readJSON(PRESET_KEY, []);
}
export function savePresets(list) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
}
export function loadSnippets() {
    return readJSON(SNIPPET_KEY, []);
}
export function saveSnippets(list) {
    localStorage.setItem(SNIPPET_KEY, JSON.stringify(list));
}

function builtinCommands(lang) {
    const en = lang === "en";
    return [
        { key: "summarize", label: en ? "Summarize above" : "Tóm tắt phía trên", text: en ? "Summarize the key points above concisely." : "Tóm tắt ngắn gọn các ý chính ở trên." },
        { key: "translate", label: en ? "Translate reply" : "Dịch câu trả lời", text: en ? "Translate the previous reply into Vietnamese." : "Dịch câu trả lời phía trên sang tiếng Anh." },
        { key: "explain", label: en ? "Explain simpler" : "Giải thích dễ hiểu", text: en ? "Explain that again in more detail and simpler terms." : "Giải thích lại chi tiết và dễ hiểu hơn." },
        { key: "shorter", label: en ? "Make concise" : "Viết ngắn hơn", text: en ? "Rewrite the above to be more concise." : "Viết lại nội dung trên ngắn gọn hơn." },
        { key: "bullets", label: en ? "As bullet points" : "Gạch đầu dòng", text: en ? "Rewrite the above as clear bullet points." : "Trình bày lại nội dung trên dưới dạng gạch đầu dòng." },
    ];
}

/**
 * Attach a slash-command popover to a textarea.
 * deps: { input, getLang } — input is the composer textarea.
 */
export function attachSlashCommands({ input, getLang }) {
    const pop = document.createElement("div");
    pop.className = "slash-popover hidden";
    (input.closest(".chat-input-box") || input.parentElement).appendChild(pop);
    let items = [];
    let active = -1;

    function commandsFor(lang) {
        const snippets = loadSnippets().map((s) => ({ key: s.name, label: s.name, text: s.text, user: true }));
        return builtinCommands(lang).concat(snippets);
    }

    function close() {
        pop.classList.add("hidden");
        pop.innerHTML = "";
        items = [];
        active = -1;
    }

    function apply(cmd) {
        input.value = cmd.text;
        close();
        input.focus();
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function render(list) {
        items = list;
        active = list.length ? 0 : -1;
        pop.innerHTML = list
            .map((c, i) => `<button type="button" class="slash-item${i === 0 ? " active" : ""}" data-i="${i}">
                <span class="slash-key">/${c.key}</span><span class="slash-label">${c.label}</span></button>`)
            .join("");
        pop.querySelectorAll(".slash-item").forEach((el) => {
            el.addEventListener("mousedown", (e) => {
                e.preventDefault();
                apply(items[parseInt(el.getAttribute("data-i"), 10)]);
            });
        });
        pop.classList.toggle("hidden", list.length === 0);
    }

    function refresh() {
        const val = input.value;
        if (!val.startsWith("/")) return close();
        const q = val.slice(1).toLowerCase();
        const list = commandsFor(getLang()).filter(
            (c) => c.key.toLowerCase().includes(q) || (c.label || "").toLowerCase().includes(q)
        );
        if (!list.length) return close();
        render(list);
    }

    input.addEventListener("input", refresh);
    input.addEventListener("keydown", (e) => {
        if (pop.classList.contains("hidden")) return;
        if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; syncActive(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; syncActive(); }
        else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); if (items[active]) apply(items[active]); }
        else if (e.key === "Escape") { close(); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));

    function syncActive() {
        pop.querySelectorAll(".slash-item").forEach((el, i) => el.classList.toggle("active", i === active));
    }

    return { close };
}

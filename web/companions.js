/**
 * Companions — AI personas with their own personality, knowledge, and a single
 * continuous chat each. Stored in localStorage. Knowledge is stuffed into the
 * system prompt (capped by token budget), no embeddings/RAG.
 */
(function (global) {
    const STORAGE_KEY = "bobigo_companions";
    const EMOJIS = ["🧑‍🚀", "🦊", "🧙", "🕵️", "🤖", "🧝", "👩‍🔬", "🐉", "🧛", "🦉", "🐱", "👽", "🧚", "🎭"];

    function uid(prefix) {
        return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    function estTokens(s) {
        s = typeof s === "string" ? s : "";
        return s ? Math.max(1, Math.ceil((s.length + 3) / 4)) : 0;
    }

    function loadCompanions() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }
    function saveCompanions(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function newCompanion(partial) {
        const lang = (partial && partial.language === "en") ? "en" : "vi";
        return Object.assign({
            id: uid("comp"),
            name: lang === "en" ? "New companion" : "Bạn đồng hành mới",
            emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            avatar: null, // optional data-URL image; falls back to emoji
            tagline: "",
            persona: "",
            instructions: "",
            knowledge: [],
            messages: [],
            language: lang,
            createdAt: new Date().toISOString(),
        }, partial || {});
    }

    /** A few ready-made companions seeded on first run. */
    function defaultCompanions(language) {
        const en = language === "en";
        const mk = (o) => newCompanion(Object.assign({ language: en ? "en" : "vi" }, o));
        return [
            mk({
                name: "Aria", emoji: "🎨",
                tagline: en ? "Creative writing muse" : "Nàng thơ sáng tác",
                persona: en ? "Warm, imaginative and encouraging; loves vivid imagery and storytelling."
                            : "Ấm áp, giàu tưởng tượng và khích lệ; thích hình ảnh sống động và kể chuyện.",
                instructions: en ? "Help brainstorm and polish creative writing. Ask about tone and audience first."
                                 : "Giúp lên ý tưởng và trau chuốt bài viết sáng tạo. Hỏi về tông và đối tượng trước.",
            }),
            mk({
                name: "Max", emoji: "🧠",
                tagline: en ? "Pragmatic coding mentor" : "Mentor lập trình thực dụng",
                persona: en ? "Direct, precise and patient; explains with small concrete examples."
                            : "Thẳng thắn, chính xác và kiên nhẫn; giải thích bằng ví dụ nhỏ cụ thể.",
                instructions: en ? "Help debug and explain code clearly. Prefer minimal, correct solutions."
                                 : "Giúp gỡ lỗi và giải thích code rõ ràng. Ưu tiên giải pháp tối giản, đúng.",
            }),
            mk({
                name: "Sage", emoji: "🧘",
                tagline: en ? "Calm reflective guide" : "Người dẫn tĩnh tại",
                persona: en ? "Calm, thoughtful and non-judgmental; speaks gently."
                            : "Điềm tĩnh, sâu sắc và không phán xét; nói nhẹ nhàng.",
                instructions: en ? "Listen, reflect, and ask open questions. Don't rush to advice."
                                 : "Lắng nghe, phản chiếu và đặt câu hỏi mở. Đừng vội khuyên.",
            }),
        ];
    }

    /** Build the system prompt from a companion, capping knowledge to a slice of the budget. */
    function buildSystemPrompt(c, opts) {
        opts = opts || {};
        const lang = c && c.language === "en" ? "en" : "vi";
        const budget = Math.max(512, (opts.contextWindow || 8192) - (opts.reserve || 2048));
        const kcap = Math.floor(budget * 0.45); // knowledge ≤ ~45% of the window
        const lines = [];
        const name = (c && c.name) || (lang === "en" ? "a companion" : "một người bạn đồng hành");
        const tag = c && c.tagline ? ", " + c.tagline : "";
        if (lang === "en") {
            lines.push(`You are ${name}${tag}.`);
            if (c && c.persona) lines.push(c.persona);
            if (c && c.instructions) lines.push(c.instructions);
            lines.push("Stay in character and reply naturally in English.");
        } else {
            lines.push(`Bạn là ${name}${tag}.`);
            if (c && c.persona) lines.push(c.persona);
            if (c && c.instructions) lines.push(c.instructions);
            lines.push("Giữ đúng nhân vật, trả lời tự nhiên bằng tiếng Việt.");
        }
        const kb = ((c && c.knowledge) || []).filter((k) => k && k.text);
        if (kb.length) {
            const head = lang === "en"
                ? "\n[Knowledge base — use when relevant:]\n"
                : "\n[Kiến thức tham khảo — dùng khi liên quan:]\n";
            let acc = head;
            let used = estTokens(acc);
            for (const k of kb) {
                const block = `\n--- ${k.name || "note"} ---\n${k.text}\n`;
                const t = estTokens(block);
                if (used + t > kcap) {
                    const remainChars = Math.max(0, (kcap - used) * 4);
                    if (remainChars > 240) {
                        acc += block.slice(0, remainChars) + (lang === "en" ? "\n[...truncated]" : "\n[...đã cắt]");
                    }
                    break;
                }
                acc += block;
                used += t;
            }
            lines.push(acc);
        }
        return lines.join("\n");
    }

    global.BobigoCompanions = { loadCompanions, saveCompanions, newCompanion, defaultCompanions, buildSystemPrompt, EMOJIS, uid };
})(window);

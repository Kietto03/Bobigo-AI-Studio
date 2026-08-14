/**
 * Roleplay worlds, characters, and session-scoped memory.
 */
(function (global) {
    const STORAGE_KEY = "bobigo_rp_worlds";
    const COLORS = ["#ef233c", "#f59e0b", "#10b981", "#6366f1", "#06b6d4", "#ec4899", "#84cc16"];
    const MEMORY_RE = /<<\s*(?:nhớ|remember)\s*:\s*(.+?)>>/gi;

    const EMPTY_SETTING = {
        genre: "",
        era: "",
        world: "",
        location: "",
        atmosphere: "",
        factions: "",
        lore: "",
        powerRules: "",
        conflict: "",
        timeWeather: "",
        sensory: "",
        taboos: "",
    };

    function normalizeSetting(raw) {
        if (!raw) return Object.assign({}, EMPTY_SETTING);
        if (typeof raw === "string") return Object.assign({}, EMPTY_SETTING, { world: raw });
        return Object.assign({}, EMPTY_SETTING, raw);
    }

    function uid(prefix) {
        return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function loadWorlds() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
            return raw.map((w) => {
                w.setting = normalizeSetting(w.setting);
                if (!w.language) w.language = "vi";
                return w;
            });
        } catch (e) {
            return [];
        }
    }

    function saveWorlds(worlds) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(worlds));
    }

    function newCharacter(partial, language) {
        const lang = language === "en" || (partial && partial.language === "en") ? "en" : "vi";
        const defaultChar = lang === "en"
            ? {
                name: "Elena",
                role: "companion",
                age: "24",
                gender: "Female",
                appearance: "Short hair, dark coat, small scar over her eyebrow.",
                personality: "Outspoken, loyal, sharp-witted and quick under pressure.",
                speech: "Speaks concisely, addresses the player by name.",
                goals: "Protect the player and uncover the truth of the past.",
                relationships: "Trusted companion of the player.",
                exampleLines: "Keep your head down. We're not safe here yet.",
                notes: "Never betrays her companions.",
            }
            : {
                name: "Linh",
                role: "bạn đồng hành",
                age: "24",
                gender: "Nữ",
                appearance: "Tóc ngắn, khoác áo tối, sẹo nhỏ trên lông mày.",
                personality: "Thẳng tính, trung thành, nhạy bén và bình tĩnh khi gặp nguy hiểm.",
                speech: "Nói ngắn gọn, xưng 'tôi', gọi người chơi bằng tên.",
                goals: "Bảo vệ người chơi và tìm ra sự thật về quá khứ.",
                relationships: "Bạn đồng hành đáng tin cậy của người chơi.",
                exampleLines: "Cẩn thận đấy. Chúng ta chưa an toàn ở đây đâu.",
                notes: "Tuyệt đối không phản bội đồng đội.",
            };

        return Object.assign({
            id: uid("char"),
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            enabled: true,
            ...defaultChar,
        }, partial || {});
    }

    function newWorld(partial) {
        const lang = (partial && partial.language === "en") ? "en" : "vi";
        const defaultTitle = lang === "en" ? "New scenario" : "Kịch bản mới";
        const defaultRules = lang === "en"
            ? "Stay in character. Respect player limits (OOC). Do not forget this session's memory."
            : "Ở trong nhân vật. Tôn trọng giới hạn (OOC). Không quên ký ức phiên này.";
        const defaultPersona = lang === "en"
            ? { name: "Player", description: "" }
            : { name: "Tôi", description: "" };

        const world = Object.assign({
            id: uid("world"),
            title: defaultTitle,
            createdAt: new Date().toISOString(),
            language: lang,
            setting: normalizeSetting(partial && partial.setting),
            rules: defaultRules,
            userPersona: defaultPersona,
            characters: [
                newCharacter(null, lang),
            ],
            memory: [],
            sceneLog: [],
            messages: [],
        }, partial || {});

        world.setting = normalizeSetting(world.setting);
        if (!world.language) world.language = lang;
        return world;
    }

    function harvestMemory(text) {
        const facts = [];
        let match;
        const re = new RegExp(MEMORY_RE.source, "gi");
        while ((match = re.exec(text || "")) !== null) {
            const fact = match[1].trim();
            if (fact) facts.push(fact);
        }
        const clean = String(text || "").replace(MEMORY_RE, "").replace(/\n{3,}/g, "\n\n").trim();
        return { clean, facts };
    }

    function addMemory(world, text, source) {
        const clipped = String(text || "").trim().slice(0, 240);
        if (!clipped) return world;
        const exists = (world.memory || []).some((m) => m.text === clipped);
        if (exists) return world;
        world.memory = (world.memory || []).concat({
            id: uid("mem"),
            text: clipped,
            source: source || "user",
            createdAt: new Date().toISOString(),
        }).slice(-40);
        return world;
    }

    function appendSceneLog(world, userText, assistantText) {
        const lang = world.language === "en" ? "en" : "vi";
        const userPrefix = lang === "en" ? "Player: " : "Người chơi: ";
        const scenePrefix = lang === "en" ? "Scene: " : "Cảnh: ";

        const line = [
            userText ? userPrefix + String(userText).replace(/\s+/g, " ").slice(0, 90) : "",
            assistantText ? scenePrefix + String(assistantText).replace(/\s+/g, " ").slice(0, 120) : "",
        ].filter(Boolean).join(" — ");

        if (!line) return world;
        world.sceneLog = (world.sceneLog || []).concat({
            at: new Date().toISOString(),
            text: line,
        }).slice(-16);
        return world;
    }

    function worldFromDraft(data, language) {
        const lang = language === "en" ? "en" : "vi";
        const world = newWorld({
            language: lang,
            title: (data && data.title) || (lang === "en" ? "New scenario" : "Kịch bản mới"),
            rules: (data && data.rules) || "",
            userPersona: (data && data.userPersona) || { name: lang === "en" ? "Player" : "Tôi", description: "" },
            setting: data && data.setting,
            characters: [],
            messages: [],
            memory: [],
            sceneLog: [],
        });
        const incoming = (data && data.characters) || [];
        world.characters = incoming.length
            ? incoming.map((c) => newCharacter(c, lang))
            : [newCharacter(null, lang)];
        world.messages = [];
        return world;
    }

    function toPayload(world) {
        const lang = world.language === "en" ? "en" : "vi";
        const defaultName = lang === "en" ? "Player" : "Tôi";
        return {
            language: world.language || "vi",
            setting: normalizeSetting(world.setting),
            rules: world.rules || "",
            userPersona: world.userPersona || { name: defaultName, description: "" },
            characters: (world.characters || []).filter((c) => c.enabled !== false),
            memory: world.memory || [],
            sceneLog: world.sceneLog || [],
        };
    }

    global.BobigoRP = {
        loadWorlds,
        saveWorlds,
        newWorld,
        newCharacter,
        harvestMemory,
        addMemory,
        appendSceneLog,
        toPayload,
        worldFromDraft,
        normalizeSetting,
        EMPTY_SETTING,
    };
})(window);

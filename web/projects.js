/**
 * Projects — group chats around a topic with shared instructions + knowledge.
 * Project metadata lives in localStorage; the chats themselves are ordinary
 * sessions tagged with `projectId`. Instructions + knowledge are prepended to
 * the system prompt (capped by token budget), no embeddings/RAG.
 */
(function (global) {
    const STORAGE_KEY = "bobigo_projects";
    const COLORS = ["#ef233c", "#6d7bff", "#22c98a", "#b06bff", "#f59e0b", "#06b6d4", "#ec4899"];

    function uid(prefix) {
        return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    function estTokens(s) {
        s = typeof s === "string" ? s : "";
        return s ? Math.max(1, Math.ceil((s.length + 3) / 4)) : 0;
    }

    function loadProjects() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            return [];
        }
    }
    function saveProjects(list) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function newProject(partial) {
        const lang = (partial && partial.language === "en") ? "en" : "vi";
        return Object.assign({
            id: uid("proj"),
            name: lang === "en" ? "New project" : "Dự án mới",
            description: "",
            instructions: "",
            knowledge: [],
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            createdAt: new Date().toISOString(),
        }, partial || {});
    }

    /** Extra system context (instructions + capped knowledge) for a project. */
    function buildContext(project, opts) {
        opts = opts || {};
        if (!project) return "";
        const lang = opts.language === "en" ? "en" : "vi";
        const budget = Math.max(512, (opts.contextWindow || 8192) - (opts.reserve || 2048));
        const kcap = Math.floor(budget * 0.4);
        const lines = [];
        lines.push(lang === "en" ? `[Project: ${project.name || "Untitled"}]` : `[Dự án: ${project.name || "Chưa đặt tên"}]`);
        if (project.instructions) lines.push(project.instructions);
        const kb = (project.knowledge || []).filter((k) => k && k.text);
        if (kb.length) {
            const head = lang === "en" ? "\n[Project knowledge — use when relevant:]\n" : "\n[Kiến thức dự án — dùng khi liên quan:]\n";
            let acc = head;
            let used = estTokens(acc);
            for (const k of kb) {
                const block = `\n--- ${k.name || "note"} ---\n${k.text}\n`;
                const t = estTokens(block);
                if (used + t > kcap) {
                    const remain = Math.max(0, (kcap - used) * 4);
                    if (remain > 240) acc += block.slice(0, remain) + (lang === "en" ? "\n[...truncated]" : "\n[...đã cắt]");
                    break;
                }
                acc += block; used += t;
            }
            lines.push(acc);
        }
        return lines.join("\n");
    }

    global.BobigoProjects = { loadProjects, saveProjects, newProject, buildContext, uid, COLORS };
})(window);

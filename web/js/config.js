/**
 * User config persistence (localStorage).
 * System-prompt defaults come from the global BobigoI18n dictionary.
 */

const STORAGE_KEY = "bobigo_config";

export function defaultConfig() {
    return {
        temperature: 0.7,
        topP: 0.9,
        repeatPenalty: 1.1,
        maxTokens: 4096,
        systemPrompt: (window.BobigoI18n && BobigoI18n.SYSTEM.vi) || "Bạn là Bobigo, trợ lý AI.",
        memory: true,
        showReasoning: true,
        webSearch: false,
        agentTools: true,
        language: "vi",
    };
}

export function loadConfig() {
    const defaults = defaultConfig();
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        const merged = { ...defaults, ...saved };
        if (typeof merged.systemPrompt === "string") {
            const oldHw = /Apple M4|Metal GPU|llama-server|Apple Silicon/i.test(merged.systemPrompt);
            const genericBobigo = /Bạn là Bobigo|You are Bobigo/.test(merged.systemPrompt);
            if (oldHw || (genericBobigo && !merged.systemPrompt.includes("list_files"))) {
                const lang = merged.language === "en" ? "en" : "vi";
                merged.systemPrompt = (window.BobigoI18n && BobigoI18n.SYSTEM[lang]) || defaults.systemPrompt;
            }
        }
        if (merged.language !== "en") merged.language = "vi";
        return merged;
    } catch (e) {
        return defaults;
    }
}

export function persistConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

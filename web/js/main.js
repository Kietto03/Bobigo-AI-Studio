/**
 * Bobigo AI Studio — Full-Featured Frontend Logic
 * Web Search + Streaming Chat + Memory + Config Panel
 */

import { escapeHtml, renderMarkdown } from "./markdown.js";
import { formatFileSize, relativeTime, downloadFile, refineSearchQuery } from "./util.js";
import { loadConfig, persistConfig } from "./config.js";
import { API_URL, HEALTH_URL, SEARCH_URL, performWebSearch, postCompress, getToolsCatalog } from "./api.js";
import { conversationTokens } from "./tokens.js";
import { initContextMeter } from "./features/contextMeter.js";
import { initMessageSearch } from "./features/messageSearch.js";
import { loadPresets, savePresets, attachSlashCommands } from "./features/promptLibrary.js";

document.addEventListener("DOMContentLoaded", () => {
    // --------------------------------------------------------------------------
    // DOM Elements
    // --------------------------------------------------------------------------
    const body = document.body;
    const themeToggle = document.getElementById("theme-toggle");
    const highlightStyle = document.getElementById("highlight-style");

    // Layout Navigation & Panels
    const navRailBtns = document.querySelectorAll(".rail-btn");
    const railChatBtn = document.getElementById("rail-chat-btn");
    const railCompanionsBtn = document.getElementById("rail-companions-btn");
    const railProjectsBtn = document.getElementById("rail-projects-btn");
    const railConfigBtn = document.getElementById("rail-config-btn");
    const openSettingsBtn = document.getElementById("open-settings-btn");
    
    const historyPanel = document.getElementById("history-panel");
    const configPanel = document.getElementById("config-panel");
    const closeConfigBtn = document.getElementById("close-config-btn");
    const topbarConfigBtn = document.getElementById("topbar-config-btn");
    const mobileToggle = document.getElementById("mobile-toggle");
    const sidebarOverlay = document.getElementById("sidebar-overlay");

    // History Panel Elements
    const historyList = document.getElementById("history-list");
    const historySearchInput = document.getElementById("history-search-input");
    const clearAllHistoryBtn = document.getElementById("clear-all-history-btn");

    // Topbar & Status
    const statusDot = document.getElementById("status-dot");

    // Web Search Toggle (Topbar button)
    const webSearchToggle = document.getElementById("web-search-toggle");
    const searchIndicator = document.getElementById("search-indicator");

    // Chat Viewport Elements
    const messagesContainer = document.getElementById("messages-container");
    const welcomeScreen = document.getElementById("welcome-screen");
    const suggestionCards = document.querySelectorAll(".suggestion-card");

    // Chat Input Elements
    const userInput = document.getElementById("user-input");
    const sendBtn = document.getElementById("send-btn");
    const attachFileBtn = document.getElementById("attach-file-btn");
    const fileInput = document.getElementById("file-input");
    const attachmentPreviewBar = document.getElementById("attachment-preview-bar");
    let attachedFiles = [];

    // Export Dropdown
    const exportDropdownBtn = document.getElementById("export-dropdown-btn");
    const exportMenu = document.getElementById("export-menu");
    const exportMdBtn = document.getElementById("export-md-btn");
    const exportJsonBtn = document.getElementById("export-json-btn");

    // Config Inputs
    const systemPromptInput = document.getElementById("system-prompt-input");
    const tempSlider = document.getElementById("temp-slider");
    const tempVal = document.getElementById("temp-val");
    const topPSlider = document.getElementById("topp-slider");
    const topPVal = document.getElementById("topp-val");
    const penaltySlider = document.getElementById("penalty-slider");
    const penaltyVal = document.getElementById("penalty-val");
    const maxTokensInput = document.getElementById("max-tokens-input");
    const toggleMemory = document.getElementById("toggle-memory");
    const toggleReasoning = document.getElementById("toggle-reasoning");
    const toggleWebsearch = document.getElementById("toggle-websearch");
    const toggleAgent = document.getElementById("toggle-agent");
    const resetConfigBtn = document.getElementById("reset-config-btn");

    // --------------------------------------------------------------------------
    // App State & Persistence
    // --------------------------------------------------------------------------
    const MAX_ATTACH_BYTES = 80 * 1024;

    let sessions = loadSessions();
    let currentSessionId = null;
    let config = loadConfig();
    let abortController = null;
    let isGenerating = false;
    let activeGenerations = new Map(); // sessionId -> { abortController, assistantMsgObj }
    let llmReady = false;
    let currentModel = "qwen35b-uncensored"; // updated from /api/health once known
    let contextInfo = { window: 8192, reserve: 2048 }; // from /api/health
    let isCompressing = false;
    let contextMeter = null; // assigned once DOM refs exist (see init below)

    // Themes: each = a base family (dark/light) + optional accent class.
    // Declared here (before initTheme runs) to avoid a TDZ error at boot.
    const THEMES = {
        obsidian:  { family: "dark",  accent: null,              label: "Obsidian" },
        daylight:  { family: "light", accent: null,              label: "Daylight" },
        indigo:    { family: "dark",  accent: "theme-indigo",    label: "Indigo" },
        evergreen: { family: "dark",  accent: "theme-evergreen", label: "Evergreen" },
        amethyst:  { family: "dark",  accent: "theme-amethyst",  label: "Amethyst" },
        porcelain: { family: "light", accent: "theme-porcelain", label: "Porcelain" },
    };
    const THEME_CLASSES = ["dark", "light", "theme-indigo", "theme-evergreen", "theme-amethyst", "theme-porcelain"];
    let currentTheme = "obsidian";
    const STYLE_CLASSES = ["style-pixel"]; // declared early — initStyle() runs before the style block
    let currentStyle = "modern";
    let appMode = "chat"; // "chat" | "companion" | "project"
    let companions = (window.BobigoCompanions && BobigoCompanions.loadCompanions()) || [];
    let currentCompanionId = null;
    let projects = (window.BobigoProjects && BobigoProjects.loadProjects()) || [];
    let currentProjectId = null; // which project is opened (null = project list)
    const welcomeDefaultHTML = welcomeScreen ? welcomeScreen.innerHTML : "";

    // Configure Marked.js
    if (typeof marked !== "undefined") {
        const renderer = new marked.Renderer();
        renderer.table = function(header, body) {
            if (typeof header === "object" && header !== null) {
                const originalHtml = marked.Renderer.prototype.table.call(this, header);
                return `<div class="table-wrapper">${originalHtml}</div>`;
            }
            return `<div class="table-wrapper"><table class="markdown-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
        };

        if (typeof marked.use === "function") {
            marked.use({ renderer: renderer });
        }

        marked.setOptions({
            gfm: true,
            breaks: true,
            renderer: renderer,
            highlight: function(code, lang) {
                if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
                    try { return hljs.highlight(code, { language: lang }).value; } catch (e) {}
                }
                return code;
            }
        });
    }

    function enhanceMarkdownElements(container) {
        if (!container) return;

        // 1. Wrap and class tables
        container.querySelectorAll("table").forEach(table => {
            if (!table.parentElement.classList.contains("table-wrapper")) {
                const wrapper = document.createElement("div");
                wrapper.className = "table-wrapper";
                table.parentNode.insertBefore(wrapper, table);
                wrapper.appendChild(table);
            }
            table.classList.add("markdown-table");
        });

        // 2. Wrap and class code blocks with language badge and Copy Code button
        container.querySelectorAll("pre").forEach(pre => {
            if (pre.parentElement && pre.parentElement.classList.contains("code-card")) return;
            const codeEl = pre.querySelector("code");
            if (!codeEl) return;

            let lang = "CODE";
            codeEl.classList.forEach(cls => {
                if (cls.startsWith("language-")) {
                    lang = cls.replace("language-", "").toUpperCase();
                }
            });

            const card = document.createElement("div");
            card.className = "code-card";

            const header = document.createElement("div");
            header.className = "code-header";

            const langBadge = document.createElement("span");
            langBadge.className = "code-lang";
            langBadge.innerHTML = `<i class="fa-solid fa-code"></i> <span>${escapeHtml(lang)}</span>`;

            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "code-copy-btn";
            const i18n = window.BobigoI18n;
            const currentLang = (config && config.language) || "vi";
            const copyText = (i18n && i18n.t(currentLang, "copyCode")) || "Sao chép mã";
            const copiedText = (i18n && i18n.t(currentLang, "copiedCode")) || "Đã chép!";
            copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> <span>${escapeHtml(copyText)}</span>`;

            copyBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                try {
                    const rawCode = codeEl.innerText || codeEl.textContent;
                    await navigator.clipboard.writeText(rawCode);
                    copyBtn.innerHTML = `<i class="fa-solid fa-check" style="color:#10b981;"></i> <span style="color:#10b981;">${escapeHtml(copiedText)}</span>`;
                    copyBtn.classList.add("copied");
                    setTimeout(() => {
                        copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> <span>${escapeHtml(copyText)}</span>`;
                        copyBtn.classList.remove("copied");
                    }, 1600);
                } catch (err) {
                    console.error("Copy code error:", err);
                }
            });

            header.appendChild(langBadge);
            header.appendChild(copyBtn);

            pre.parentNode.insertBefore(card, pre);
            card.appendChild(header);
            card.appendChild(pre);
        });

        // 3. Syntax highlight if hljs available
        if (typeof hljs !== "undefined") {
            container.querySelectorAll("pre code").forEach((el) => {
                try {
                    hljs.highlightElement(el);
                } catch (e) {}
            });
        }
    }

    // Initialize App
    initTheme();
    initStyle();
    initConfigUI();
    initSessions();
    initCompanions();
    initProjects();
    syncWebSearchUI();
    applyLanguage(config.language || "vi");
    checkHealth();
    setInterval(checkHealth, 10000);

    // --------------------------------------------------------------------------
    // Context meter + auto-compression
    // --------------------------------------------------------------------------
    contextMeter = initContextMeter({
        root: document.getElementById("context-meter"),
        fill: document.getElementById("ctx-fill"),
        text: document.getElementById("ctx-text"),
        getBudget: () => contextInfo.window - contextInfo.reserve,
    });
    updateContextMeter();

    function currentSystemPrompt() {
        if (appMode === "companion") {
            const c = getActiveSession();
            return (c && window.BobigoCompanions)
                ? BobigoCompanions.buildSystemPrompt(c, { contextWindow: contextInfo.window, reserve: contextInfo.reserve })
                : "";
        }
        let sp = config.systemPrompt || "";
        const s = getActiveSession();
        if (s && s.projectId && window.BobigoProjects) {
            const proj = projects.find((p) => p.id === s.projectId);
            if (proj) sp = (sp + "\n\n" + BobigoProjects.buildContext(proj, { contextWindow: contextInfo.window, reserve: contextInfo.reserve, language: config.language })).trim();
        }
        return sp;
    }

    function updateContextMeter() {
        if (!contextMeter) return; // not yet initialized (early renders during boot)
        const session = getActiveSession();
        contextMeter.update((session && session.messages) || [], currentSystemPrompt());
    }

    const COMPRESS_KEEP_RECENT = 4; // last N messages kept verbatim

    async function maybeAutoCompress(session) {
        if (!config.memory || isCompressing || !session) return;
        const budget = Math.max(512, contextInfo.window - contextInfo.reserve);
        const used = conversationTokens(session.messages, currentSystemPrompt());
        if (used < budget * 0.9) return;
        await compressSession(session, { silent: true });
    }

    async function compressSession(session, opts = {}) {
        if (isCompressing || !session || !Array.isArray(session.messages)) return;
        if (session.messages.length <= COMPRESS_KEEP_RECENT + 1) return;
        isCompressing = true;
        try {
            const head = session.messages.slice(0, session.messages.length - COMPRESS_KEEP_RECENT);
            const tail = session.messages.slice(session.messages.length - COMPRESS_KEEP_RECENT);
            const i18n = window.BobigoI18n;
            const lang = config.language || "vi";
            const res = await postCompress(head, { keepRecent: 0, language: lang, model: currentModel });
            if (!res || !res.summary) return;
            const label = (i18n && i18n.t(lang, "memoryNote")) || "Bản ghi nhớ";
            const node = {
                role: "system",
                content: `[${label}]\n${res.summary}`,
                summary: true,
                count: res.compressed_count || head.length,
                createdAt: new Date().toISOString(),
            };
            session.messages = [node, ...tail];
            saveSessions();
            if (currentSessionId === session.id) {
                renderCurrentSession();
                updateContextMeter();
            }
        } catch (err) {
            console.warn("Compression failed:", err);
            if (!opts.silent) {
                const i18n = window.BobigoI18n;
                const lang = config.language || "vi";
                alert((i18n && i18n.t(lang, "compressFailed")) || "Nén hội thoại thất bại.");
            }
        } finally {
            isCompressing = false;
        }
    }

    document.getElementById("ctx-compress-btn")?.addEventListener("click", () => {
        if (!llmReady) return;
        compressSession(getActiveSession(), { silent: false });
    });

    // --------------------------------------------------------------------------
    // In-conversation search + pinned filter
    // --------------------------------------------------------------------------
    const msgSearchBar = document.getElementById("msg-search-bar");
    const msgSearchInput = document.getElementById("msg-search-input");
    const msgSearch = initMessageSearch({
        container: messagesContainer,
        input: msgSearchInput,
        countEl: document.getElementById("msg-search-count"),
    });

    function openMsgSearch() {
        if (!msgSearchBar) return;
        msgSearchBar.classList.remove("hidden");
        msgSearchInput.focus();
        msgSearchInput.select();
    }
    function closeMsgSearch() {
        if (!msgSearchBar) return;
        msgSearchBar.classList.add("hidden");
        msgSearch.clear();
        msgSearchInput.value = "";
    }
    document.getElementById("msg-search-btn")?.addEventListener("click", () => {
        if (msgSearchBar && msgSearchBar.classList.contains("hidden")) openMsgSearch();
        else closeMsgSearch();
    });
    document.getElementById("msg-search-close")?.addEventListener("click", closeMsgSearch);
    document.getElementById("msg-search-prev")?.addEventListener("click", () => msgSearch.next(-1));
    document.getElementById("msg-search-next")?.addEventListener("click", () => msgSearch.next(1));
    document.getElementById("msg-search-pinned")?.addEventListener("click", (e) => {
        const on = msgSearch.togglePinned();
        e.currentTarget.classList.toggle("active", on);
    });
    if (msgSearchInput) {
        msgSearchInput.addEventListener("input", () => msgSearch.run());
        msgSearchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); msgSearch.next(e.shiftKey ? -1 : 1); }
            if (e.key === "Escape") { e.preventDefault(); closeMsgSearch(); }
        });
    }

    // --------------------------------------------------------------------------
    // Prompt library: system-prompt presets + slash commands
    // --------------------------------------------------------------------------
    const presetSelect = document.getElementById("preset-select");

    function refreshPresetSelect() {
        if (!presetSelect) return;
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const pick = (i18n && i18n.t(lang, "presetPick")) || "— Preset —";
        const presets = loadPresets();
        presetSelect.innerHTML = `<option value="">${escapeHtml(pick)}</option>` +
            presets.map((p, i) => `<option value="${i}">${escapeHtml(p.name)}</option>`).join("");
    }
    refreshPresetSelect();

    presetSelect?.addEventListener("change", () => {
        const idx = parseInt(presetSelect.value, 10);
        const presets = loadPresets();
        if (Number.isInteger(idx) && presets[idx]) {
            config.systemPrompt = presets[idx].prompt;
            if (systemPromptInput) systemPromptInput.value = presets[idx].prompt;
            saveConfig();
        }
    });

    document.getElementById("preset-save-btn")?.addEventListener("click", () => {
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const name = prompt((i18n && i18n.t(lang, "presetName")) || "Tên preset:");
        if (!name) return;
        const presets = loadPresets();
        const existing = presets.findIndex((p) => p.name === name);
        const entry = { name: name.trim(), prompt: (systemPromptInput?.value || config.systemPrompt || "").trim() };
        if (existing >= 0) presets[existing] = entry;
        else presets.push(entry);
        savePresets(presets);
        refreshPresetSelect();
        presetSelect.value = String(presets.findIndex((p) => p.name === entry.name));
    });

    document.getElementById("preset-del-btn")?.addEventListener("click", () => {
        const idx = parseInt(presetSelect?.value, 10);
        const presets = loadPresets();
        if (!Number.isInteger(idx) || !presets[idx]) return;
        presets.splice(idx, 1);
        savePresets(presets);
        refreshPresetSelect();
    });

    attachSlashCommands({ input: userInput, getLang: () => config.language || "vi" });

    // --------------------------------------------------------------------------
    // Settings modal: tabs, theme swatches, tools/MCP catalog
    // --------------------------------------------------------------------------
    document.querySelectorAll(".settings-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            const key = tab.getAttribute("data-settings-tab");
            document.querySelectorAll(".settings-tab").forEach((t) => t.classList.toggle("active", t === tab));
            document.querySelectorAll(".settings-panel").forEach((p) => {
                p.classList.toggle("active", p.getAttribute("data-settings-panel") === key);
            });
        });
    });

    document.querySelectorAll(".theme-swatch").forEach((sw) => {
        sw.addEventListener("click", () => setTheme(sw.getAttribute("data-theme")));
    });
    document.querySelectorAll(".style-swatch").forEach((sw) => {
        sw.addEventListener("click", () => setStyle(sw.getAttribute("data-style")));
    });

    // Close settings when clicking the dimmed backdrop.
    if (configPanel) {
        configPanel.addEventListener("click", (e) => {
            if (e.target === configPanel) closeConfigDrawer();
        });
    }

    const TOOL_NOTES = {
        vi: {
            web_search: "Tìm web qua DuckDuckGo · dữ kiện mới",
            calculator: "Toán học AST an toàn (không eval)",
            code_interpreter: "Python sandbox · timeout 15s",
            url_reader: "Đọc trang web · chặn SSRF",
            list_files: "Liệt kê file trong workspace",
            read_file: "Đọc file text/PDF trong workspace",
        },
        en: {
            web_search: "Web search via DuckDuckGo · fresh facts",
            calculator: "Safe AST math (no eval)",
            code_interpreter: "Python sandbox · 15s timeout",
            url_reader: "Read web pages · blocks SSRF",
            list_files: "List workspace files",
            read_file: "Read workspace text/PDF files",
        },
    };

    let settingsCatalogLoaded = false;
    async function refreshSettingsCatalog() {
        if (settingsCatalogLoaded) return; // fetch once per session
        const toolsEl = document.getElementById("tools-builtin-list");
        const mcpEl = document.getElementById("mcp-servers-list");
        if (!toolsEl && !mcpEl) return;
        const lang = config.language || "vi";
        const notes = TOOL_NOTES[lang] || TOOL_NOTES.vi;
        const data = await getToolsCatalog();
        settingsCatalogLoaded = true;
        if (toolsEl) {
            toolsEl.innerHTML = (data.builtin || []).map((t) => `
                <div class="tool-entry">
                    <div class="tool-entry-name"><i class="fa-solid fa-wrench"></i> ${escapeHtml(t.name || "")}</div>
                    <div class="tool-entry-desc">${escapeHtml(notes[t.name] || t.description || "")}</div>
                </div>`).join("");
        }
        if (mcpEl) {
            const servers = data.servers || [];
            if (!servers.length) {
                mcpEl.innerHTML = `<div class="mcp-empty">${lang === "en" ? "No MCP servers connected." : "Chưa kết nối MCP server nào."}</div>`;
            } else {
                mcpEl.innerHTML = servers.map((s) => `
                    <div class="mcp-server">
                        <div class="mcp-head">
                            <span class="mcp-dot ${s.connected ? "ok" : "off"}"></span>
                            <strong>${escapeHtml(s.name || "")}</strong>
                            <span class="mcp-status">${s.connected ? ((s.tools || []).length + " tools") : escapeHtml(s.error || "offline")}</span>
                        </div>
                        ${(s.tools || []).length ? `<div class="mcp-tools">${(s.tools || []).map((t) => `<span class="chiptag">${escapeHtml(t.name || "")}</span>`).join("")}</div>` : ""}
                    </div>`).join("");
            }
        }
    }

    // --------------------------------------------------------------------------
    // Theme Switcher (multi-theme)
    // --------------------------------------------------------------------------
    function normalizeTheme(name) {
        if (name === "dark") return "obsidian";
        if (name === "light") return "daylight";
        return THEMES[name] ? name : "obsidian";
    }

    function initTheme() {
        setTheme(normalizeTheme(localStorage.getItem("bobigo_theme") || "obsidian"));
    }

    function setTheme(name) {
        const theme = THEMES[name] || THEMES.obsidian;
        currentTheme = THEMES[name] ? name : "obsidian";
        body.classList.remove(...THEME_CLASSES);
        body.classList.add(theme.family);
        if (theme.accent) body.classList.add(theme.accent);
        if (highlightStyle) {
            highlightStyle.href = theme.family === "light"
                ? "vendor/hljs/github.min.css"
                : "vendor/hljs/tokyo-night-dark.min.css";
        }
        localStorage.setItem("bobigo_theme", currentTheme);
        document.querySelectorAll(".theme-swatch").forEach((s) => {
            s.classList.toggle("active", s.getAttribute("data-theme") === currentTheme);
        });
    }

    // --- Visual style (shape/typography skin, independent of theme) ---------
    function initStyle() {
        const saved = localStorage.getItem("bobigo_style") || "modern";
        setStyle(saved);
    }
    function setStyle(name) {
        currentStyle = (name === "pixel") ? "pixel" : "modern";
        body.classList.remove(...STYLE_CLASSES);
        if (currentStyle === "pixel") body.classList.add("style-pixel");
        localStorage.setItem("bobigo_style", currentStyle);
        document.querySelectorAll(".style-swatch").forEach((s) => {
            s.classList.toggle("active", s.getAttribute("data-style") === currentStyle);
        });
    }

    // Optional quick sun/moon toggle (theme selection now lives in Settings).
    if (themeToggle) {
        themeToggle.addEventListener("click", () => {
            const isLight = (THEMES[currentTheme] || THEMES.obsidian).family === "light";
            setTheme(isLight ? "obsidian" : "daylight");
        });
    }

    // --------------------------------------------------------------------------
    // Navigation Rail & Drawer Controllers (Responsive)
    // --------------------------------------------------------------------------
    function isMobile() {
        return window.innerWidth <= 768;
    }

    function syncSidebarOverlay() {
        if (!sidebarOverlay) return;
        const open = document.body.classList.contains("sidebar-open");
        if (isMobile() && open) {
            sidebarOverlay.classList.remove("hidden");
            sidebarOverlay.classList.add("active");
        } else {
            sidebarOverlay.classList.remove("active");
            sidebarOverlay.classList.add("hidden");
        }
    }

    // Desktop: panel is a persistent column, collapsible via sidebar-collapsed.
    // Mobile: off-canvas drawer via sidebar-open.
    function setSidebarCollapsed(on) {
        document.body.classList.toggle("sidebar-collapsed", !!on);
        localStorage.setItem("bobigo_sidebar_collapsed", on ? "1" : "0");
    }

    function openHistoryDrawer() {
        document.body.classList.add("sidebar-open");
        if (!isMobile()) setSidebarCollapsed(false); // clicking a rail tab re-opens it
        syncSidebarOverlay();
    }

    function closeHistoryDrawer() {
        document.body.classList.remove("sidebar-open");
        syncSidebarOverlay();
    }

    function toggleHistoryDrawer() {
        if (document.body.classList.contains("sidebar-open")) closeHistoryDrawer();
        else openHistoryDrawer();
    }

    // Settings is now a centered modal (its own backdrop), not a slide-out.
    function openConfigDrawer() {
        configPanel.classList.remove("hidden");
        document.body.classList.add("config-open");
        updateHealthSpeedDisplay();
        if (typeof refreshSettingsCatalog === "function") refreshSettingsCatalog();
    }

    function closeConfigDrawer() {
        configPanel.classList.add("hidden");
        document.body.classList.remove("config-open");
    }

    function toggleConfigDrawer() {
        if (configPanel.classList.contains("hidden")) {
            openConfigDrawer();
        } else {
            closeConfigDrawer();
        }
    }

    function closeAllDrawers() {
        configPanel.classList.add("hidden");
        document.body.classList.remove("sidebar-open", "config-open");
        if (sidebarOverlay) {
            sidebarOverlay.classList.remove("active");
            sidebarOverlay.classList.add("hidden");
        }
    }

    // Desktop shows the panel by default; phones start collapsed.
    if (isMobile()) closeAllDrawers();
    else document.body.classList.add("sidebar-open");

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", () => closeHistoryDrawer());
    }

    // Click-away closes/hides the history panel when clicking outside nav rail or history panel.
    document.addEventListener("click", (e) => {
        if (e.target.closest(".history-panel") || e.target.closest(".nav-rail")
            || e.target.closest(".chat-menu") || e.target.closest(".modal-backdrop")
            || e.target.closest("#mobile-toggle")) return;

        if (isMobile()) {
            if (document.body.classList.contains("sidebar-open")) {
                closeHistoryDrawer();
            }
        } else {
            if (!document.body.classList.contains("sidebar-collapsed")) {
                setSidebarCollapsed(true);
            }
        }
    });

    railChatBtn.addEventListener("click", () => {
        setMode("chat");
        setNavActive(railChatBtn);
        openHistoryDrawer();
    });

    if (railCompanionsBtn) {
        railCompanionsBtn.addEventListener("click", () => {
            setMode("companion");
            setNavActive(railCompanionsBtn);
            openHistoryDrawer();
        });
    }

    if (railProjectsBtn) {
        railProjectsBtn.addEventListener("click", () => {
            currentProjectId = null; // start at the project list
            setMode("project");
            setNavActive(railProjectsBtn);
            openHistoryDrawer();
        });
    }

    if (railConfigBtn) {
        railConfigBtn.addEventListener("click", () => {
            setNavActive(railConfigBtn);
            toggleConfigDrawer();
        });
    }

    openSettingsBtn.addEventListener("click", () => {
        setNavActive(openSettingsBtn);
        openConfigDrawer();
    });

    closeConfigBtn.addEventListener("click", () => {
        closeConfigDrawer();
        setNavActive(railChatBtn);
    });

    topbarConfigBtn.addEventListener("click", () => {
        toggleConfigDrawer();
    });

    if (mobileToggle) {
        mobileToggle.addEventListener("click", () => {
            if (isMobile()) toggleHistoryDrawer();
            else setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
        });
    }

    // Panel-header chevron: desktop collapses the column, mobile closes the drawer.
    document.getElementById("sidebar-compact-btn")?.addEventListener("click", () => {
        if (isMobile()) closeHistoryDrawer();
        else setSidebarCollapsed(true);
    });
    if (!isMobile() && localStorage.getItem("bobigo_sidebar_collapsed") === "1") {
        setSidebarCollapsed(true);
    }

    // Topbar conversation title → dropdown of actions (Claude-style).
    document.getElementById("convo-title-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        const s = getActiveSession();
        if (!s) return;
        if (appMode === "companion") { openCompanionEditor(s.id); return; }
        openChatMenu(e.currentTarget, s, "");
    });

    // F2 renames the active chat (matching the item action shortcut).
    document.addEventListener("keydown", (e) => {
        if (e.key === "F2" && appMode === "chat" && currentSessionId
            && !/^(INPUT|TEXTAREA)$/.test((e.target.tagName || ""))) {
            if (historyList.querySelector(`.history-item[data-id="${currentSessionId}"]`)) {
                e.preventDefault();
                startRenameSession(currentSessionId);
            }
        }
    });

    window.addEventListener("resize", () => {
        if (!isMobile()) {
            if (sidebarOverlay) {
                sidebarOverlay.classList.remove("active");
                sidebarOverlay.classList.add("hidden");
            }
        }
    });

    function setNavActive(btn) {
        navRailBtns.forEach(b => b.classList.remove("active"));
        if (btn) btn.classList.add("active");
    }

    // --------------------------------------------------------------------------
    // Web Search Toggle
    // --------------------------------------------------------------------------
    // Web search now lives in Settings → Tools; keep this resilient if the old
    // topbar toggle is absent.
    if (webSearchToggle) {
        webSearchToggle.addEventListener("click", () => {
            config.webSearch = !config.webSearch;
            saveConfig();
            syncWebSearchUI();
        });
    }

    function syncWebSearchUI() {
        if (webSearchToggle) webSearchToggle.classList.toggle("active", !!config.webSearch);
        if (searchIndicator) searchIndicator.textContent = config.webSearch ? "ON" : "OFF";
        if (toggleWebsearch) toggleWebsearch.checked = config.webSearch;
    }

    // --------------------------------------------------------------------------
    // Backend Health Check
    // --------------------------------------------------------------------------
    const statusLabel = document.getElementById("status-label");
    const statusBanner = document.getElementById("status-banner");
    const healthCardLine = document.getElementById("health-card-line");

    function applyHealth(data) {
        llmReady = !!(data && data.llm_ready);
        const jinjaBad = data && data.jinja_known && data.jinja === false;
        const label = statusLabel;
        const dot = statusDot;
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";

        if (!data || !data.llm_ready) {
            if (dot) dot.className = "status-dot loading";
            if (label) label.textContent = i18n ? i18n.t(lang, "loadingModel") : "Đang tải mô hình";
            if (statusBanner) {
                statusBanner.className = "status-banner";
                statusBanner.textContent = (data && data.message) || (lang === "en" ? "Waiting for llama-server to load model into GPU…" : "Đang chờ llama-server nạp model vào GPU…");
            }
        } else if (jinjaBad) {
            if (dot) dot.className = "status-dot online";
            if (label) label.textContent = i18n ? i18n.t(lang, "ready") : "Sẵn sàng";
            if (statusBanner) {
                statusBanner.className = "status-banner hidden";
                statusBanner.textContent = "";
            }
        } else {
            if (dot) dot.className = "status-dot online";
            if (label) label.textContent = i18n ? i18n.t(lang, "ready") : "Sẵn sàng";
            if (statusBanner) {
                statusBanner.className = "status-banner hidden";
                statusBanner.textContent = "";
            }
        }
        if (data && data.model) currentModel = data.model;
        if (data && Number.isFinite(data.context_window)) contextInfo.window = data.context_window;
        if (data && Number.isFinite(data.reply_reserve)) contextInfo.reserve = data.reply_reserve;
        updateContextMeter();
        const online = !!(data && data.llm_ready);
        const healthCard = document.getElementById("health-card");
        if (healthCard) {
            healthCard.classList.toggle("ready", online);
            healthCard.classList.toggle("loading", !online);
        }
        const hDot = document.getElementById("health-dot");
        const hStatus = document.getElementById("health-status");
        const hModel = document.getElementById("health-model");
        const hSpeed = document.getElementById("health-speed");
        const hLatency = document.getElementById("health-latency");
        const hJinja = document.getElementById("health-jinja");
        const hCtx = document.getElementById("health-ctx");
        if (hDot) hDot.className = "health-dot " + (online ? (jinjaBad ? "warn" : "online") : "loading");
        if (hStatus) hStatus.textContent = online ? (i18n ? i18n.t(lang, "ready") : "Sẵn sàng") : (i18n ? i18n.t(lang, "loadingModel") : "Đang tải mô hình");
        if (hModel) { const m = (data && data.model) || "—"; hModel.textContent = m.length > 30 ? "…" + m.slice(-30) : m; hModel.title = m; }
        if (hLatency) hLatency.textContent = (data && Number.isFinite(data.latency)) ? `${data.latency} ms` : "—";
        if (hJinja) hJinja.textContent = data && data.jinja_known ? (data.jinja ? "✓" : "✗") : "?";
        if (hCtx) hCtx.textContent = (data && data.context_window) ? data.context_window.toLocaleString() : "—";
        updateHealthSpeedDisplay();
        if (!isGenerating) {
            sendBtn.disabled = userInput.value.trim() === "" || !llmReady;
        }
        userInput.placeholder = llmReady 
            ? (i18n ? i18n.t(lang, "inputPh") : "Nhắn cho Bobigo…") 
            : (lang === "en" ? "Waiting for model to be ready…" : "Đợi mô hình sẵn sàng…");
    }

    function updateHealthSpeedDisplay(tps) {
        const hSpeed = document.getElementById("health-speed");
        if (!hSpeed) return;
        const val = tps || localStorage.getItem("bobigo_last_tps");
        if (val && parseFloat(val) > 0) {
            hSpeed.textContent = `${val} tokens/s`;
            hSpeed.title = `${val} tokens/s`;
        } else {
            hSpeed.textContent = "—";
        }
    }

    async function checkHealth() {
        const lang = config.language || "vi";
        const t0 = performance.now();
        try {
            const res = await fetch(HEALTH_URL, { cache: "no-store" });
            const latency = Math.round(performance.now() - t0);
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data.llm_ready === "boolean") {
                    data.latency = latency;
                    applyHealth(data);
                    return;
                }
            }
        } catch (e) {
            /* fall through to /v1/models */
        }

        try {
            const t1 = performance.now();
            const res = await fetch("/v1/models", { cache: "no-store" });
            const latency = Math.round(performance.now() - t1);
            if (res.ok) {
                const data = await res.json();
                const model = (data.data && data.data[0] && data.data[0].id)
                    || (data.models && data.models[0] && (data.models[0].name || data.models[0].model))
                    || "local";
                applyHealth({
                    llm_ready: true,
                    jinja: null,
                    jinja_known: false,
                    model,
                    latency,
                    message: lang === "en" ? "Ready" : "Sẵn sàng",
                });
                return;
            }
        } catch (e) {
            /* model still down */
        }

        applyHealth({
            llm_ready: false,
            jinja: null,
            jinja_known: false,
            model: null,
            message: lang === "en" ? "Model not ready. Please wait for llama-server or run ./run.sh." : "Mô hình chưa sẵn sàng. Đợi llama-server hoặc chạy lại ./run.sh (dùng .venv).",
        });
    }

    // --------------------------------------------------------------------------
    // Web Search Function
    // --------------------------------------------------------------------------
    function buildToolEventsHTML(events, collapsed) {
        if (!events || events.length === 0) return "";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const items = events.map((ev) => `
            <div class="tool-event-item">
                <div class="te-name"><i class="fa-solid fa-wrench"></i> ${escapeHtml(ev.name || "")}</div>
                <div class="te-args">${escapeHtml(String(ev.arguments || "").slice(0, 400))}</div>
                <div class="te-result">${escapeHtml(String(ev.result || "").slice(0, 800))}</div>
            </div>
        `).join("");
        const openAttr = collapsed ? "" : " open";
        const title = (i18n && i18n.t(lang, "toolRun")) || "Công cụ";
        return `<details class="tool-calls-card"${openAttr}>
            <summary><i class="fa-solid fa-screwdriver-wrench"></i> ${escapeHtml(title)} (${events.length})</summary>
            <div class="tool-calls-content">${items}</div>
        </details>`;
    }

    function formatSearchResultsForContext(results) {
        if (!results || results.length === 0) return "";
        let text = "\n\n--- KẾT QUẢ TÌM KIẾM WEB ---\n";
        results.forEach((r, i) => {
            text += `\n[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}\n`;
        });
        text += "\n--- HẾT KẾT QUẢ TÌM KIẾM ---\n";
        text += "Hãy sử dụng thông tin tìm kiếm web ở trên để trả lời câu hỏi người dùng một cách chính xác. Trích dẫn nguồn khi cần thiết.\n";
        return text;
    }

    function buildSearchResultsHTML(results) {
        if (!results || results.length === 0) return "";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const title = (i18n && i18n.t(lang, "searchResultsSummary")) || "Kết quả tìm kiếm Web";
        let items = results.map(r => `
            <div class="search-result-item">
                <div class="sr-title">${escapeHtml(r.title)}</div>
                <div class="sr-url">${escapeHtml(r.url)}</div>
                <div class="sr-snippet">${escapeHtml(r.snippet)}</div>
            </div>
        `).join("");

        return `<details class="search-results-card" open>
            <summary><i class="fa-solid fa-globe"></i> ${escapeHtml(title)} (${results.length})</summary>
            <div class="search-results-content">${items}</div>
        </details>`;
    }

    // --------------------------------------------------------------------------
    // Session & History Management
    // --------------------------------------------------------------------------
    function loadSessions() {
        try {
            return JSON.parse(localStorage.getItem("bobigo_sessions")) || [];
        } catch (e) {
            return [];
        }
    }

    function saveSessions() {
        if (appMode === "companion") {
            if (window.BobigoCompanions) BobigoCompanions.saveCompanions(companions);
            return;
        }
        localStorage.setItem("bobigo_sessions", JSON.stringify(sessions));
    }

    function initSessions() {
        if (sessions.length === 0) {
            createNewSession(false);
        } else {
            currentSessionId = sessions[0].id;
        }
        renderHistoryList();
        renderCurrentSession();
    }

    function createNewSession(switchImmediately = true) {
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const newSession = {
            id: "session_" + Date.now(),
            title: i18n ? i18n.t(lang, "newChat") : (lang === "en" ? "New chat" : "Cuộc trò chuyện mới"),
            createdAt: new Date().toISOString(),
            messages: []
        };
        sessions.unshift(newSession);
        saveSessions();
        if (switchImmediately) {
            currentSessionId = newSession.id;
            renderHistoryList();
            renderCurrentSession();
        }
        return newSession;
    }

    function getActiveSession() {
        if (appMode === "companion") {
            return companions.find((c) => c.id === currentCompanionId) || companions[0] || null;
        }
        const found = sessions.find(s => s.id === currentSessionId);
        if (appMode === "project") return found || null; // no cross-project fallback
        return found || sessions[0];
    }

    function initCompanions() {
        if (!window.BobigoCompanions) return;
        companions = BobigoCompanions.loadCompanions();
        if (!companions.length && !localStorage.getItem("bobigo_companions_seeded")) {
            companions = BobigoCompanions.defaultCompanions(config.language);
            BobigoCompanions.saveCompanions(companions);
            localStorage.setItem("bobigo_companions_seeded", "1");
        }
        currentCompanionId = companions.length ? companions[0].id : null;
    }

    function createCompanion() {
        if (!window.BobigoCompanions) return null;
        const c = BobigoCompanions.newCompanion({ language: config.language });
        companions.unshift(c);
        currentCompanionId = c.id;
        saveSessions();
        return c;
    }

    function initProjects() {
        if (!window.BobigoProjects) return;
        projects = BobigoProjects.loadProjects();
    }
    function getCurrentProject() {
        return projects.find((p) => p.id === currentProjectId) || null;
    }

    function setMode(mode) {
        appMode = mode;
        document.body.classList.toggle("mode-companion", mode === "companion");
        document.body.classList.toggle("mode-project", mode === "project");
        const searchWrap = document.getElementById("history-search-wrap");
        const title = document.getElementById("sidebar-title");
        const i18n = window.BobigoI18n;
        if (searchWrap) searchWrap.classList.toggle("hidden", mode !== "chat");
        const titleKey = mode === "companion" ? "companions" : (mode === "project" ? "projects" : "conversations");
        if (title) title.textContent = i18n ? i18n.t(config.language, titleKey) : titleKey;
        setModeLabel();
        applyWelcomeCopy();
        renderSidebar();
        renderCurrentSession();
    }

    // Update the topbar conversation title from the active session/companion.
    function setModeLabel() {
        const titleEl = document.getElementById("convo-title");
        if (!titleEl) return;
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const s = getActiveSession();
        if (appMode === "companion") {
            titleEl.textContent = s ? (s.name || (i18n ? i18n.t(lang, "companions") : "Companion")) : (i18n ? i18n.t(lang, "companions") : "Companions");
        } else {
            titleEl.textContent = (s && s.title) ? s.title : (i18n ? i18n.t(lang, "conversations") : "Cuộc trò chuyện");
        }
    }

    function applyWelcomeCopy() {
        if (!welcomeScreen || !welcomeDefaultHTML) return;
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        if (appMode !== "companion") {
            welcomeScreen.innerHTML = welcomeDefaultHTML;
            if (i18n) {
                const sub = document.getElementById("welcome-sub");
                const h1 = document.getElementById("welcome-h1");
                if (sub) sub.textContent = i18n.t(lang, "welcomeSub");
                if (h1) h1.innerHTML = `${i18n.t(lang, "welcomeTitle")}<span class="gradient-text">Bobigo</span>`;
                i18n.apply(lang);
            }
            welcomeScreen.querySelectorAll(".suggestion-card").forEach((card) => {
                card.addEventListener("click", () => {
                    if (isGenerating) return;
                    const prompt = card.getAttribute("data-prompt");
                    if (prompt) {
                        userInput.value = prompt;
                        handleSendMessage();
                    }
                });
            });
            return;
        }
        // Companion welcome
        const c = getActiveSession();
        const h1 = welcomeScreen.querySelector("h1");
        const p = welcomeScreen.querySelector("p");
        const grid = welcomeScreen.querySelector(".suggestions-grid");
        if (c) {
            if (h1) h1.innerHTML = `<span class="welcome-ava">${companionAvatarHTML(c)}</span> <span class="gradient-text">${escapeHtml(c.name || "")}</span>`;
            if (p) p.textContent = c.tagline || (lang === "en" ? "Say hello to start chatting." : "Chào một câu để bắt đầu trò chuyện.");
            if (grid) grid.innerHTML = "";
        } else {
            if (h1) h1.innerHTML = i18n ? i18n.t(lang, "companionsWelcomeH1") : 'Tạo <span class="gradient-text">Companion</span>';
            if (p) p.textContent = i18n ? i18n.t(lang, "companionsWelcomeSub") : "Tạo một nhân vật AI có tính cách và kiến thức riêng để trò chuyện.";
            if (grid) {
                grid.innerHTML = `<button class="suggestion-card" data-comp-action="new">
                    <div class="card-header-icon"><i class="fa-solid fa-user-plus"></i></div>
                    <div class="card-title">${escapeHtml(i18n ? i18n.t(lang, "newCompanion") : "Companion mới")}</div>
                    <div class="card-desc">${escapeHtml(i18n ? i18n.t(lang, "newCompanionDesc") : "Đặt tên, tính cách, nạp kiến thức")}</div>
                </button>`;
                const b = grid.querySelector(".suggestion-card");
                if (b) b.addEventListener("click", () => openCompanionEditor(null));
            }
        }
    }

    function renderSidebar() {
        const searchWrap = document.getElementById("history-search-wrap");
        const footer = document.getElementById("sidebar-footer");
        if (appMode === "companion") {
            if (searchWrap) searchWrap.classList.add("hidden");
            if (footer) footer.classList.add("hidden");
            renderCompanionList();
        } else if (appMode === "project") {
            if (searchWrap) searchWrap.classList.add("hidden");
            if (footer) footer.classList.add("hidden");
            if (currentProjectId) renderProjectChats(); else renderProjectList();
        } else {
            if (searchWrap) searchWrap.classList.remove("hidden");
            if (footer) footer.classList.remove("hidden");
            renderHistoryList();
        }
    }

    function companionAvatarHTML(c) {
        if (c && c.avatar) return `<img class="companion-avatar-img" src="${c.avatar}" alt="">`;
        return escapeHtml((c && c.emoji) || "🎭");
    }

    // Downscale + center-crop an image file to a small square data-URL (keeps
    // localStorage tiny — avatars end up ~5–15KB).
    function resizeImageToDataURL(file, size = 128, quality = 0.85) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const s = Math.min(img.width, img.height);
                const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
                const canvas = document.createElement("canvas");
                canvas.width = size; canvas.height = size;
                canvas.getContext("2d").drawImage(img, sx, sy, s, s, 0, 0, size, size);
                resolve(canvas.toDataURL("image/jpeg", quality));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
            img.src = url;
        });
    }

    function renderCompanionList() {
        historyList.innerHTML = "";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "companion-new-btn";
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${escapeHtml(i18n ? i18n.t(lang, "newCompanion") : "Companion mới")}`;
        addBtn.addEventListener("click", () => openCompanionEditor(null));
        historyList.appendChild(addBtn);

        if (!companions.length) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = i18n ? i18n.t(lang, "noCompanions") : "Chưa có companion nào.";
            historyList.appendChild(empty);
            return;
        }

        companions.forEach((c) => {
            const item = document.createElement("div");
            const genning = activeGenerations.has(c.id) ? "is-generating" : "";
            item.className = `companion-card ${c.id === currentCompanionId ? "active" : ""} ${genning}`;
            const kn = (c.knowledge || []).length;
            const knLabel = i18n ? i18n.t(lang, "knowledgeItems") : "mục kiến thức";
            item.innerHTML = `
                <div class="companion-emoji">${companionAvatarHTML(c)}</div>
                <div class="companion-meta">
                    <div class="companion-name">${escapeHtml(c.name || "")}</div>
                    <div class="companion-tag">${escapeHtml(c.tagline || `${kn} ${knLabel}`)}</div>
                </div>
                <button type="button" class="companion-edit" title="${i18n ? i18n.t(lang, "editCompanion") : "Sửa"}"><i class="fa-solid fa-pen"></i></button>`;
            item.addEventListener("click", (e) => {
                if (e.target.closest(".companion-edit")) return;
                currentCompanionId = c.id;
                renderSidebar();
                renderCurrentSession();
                setModeLabel();
                if (isMobile()) closeAllDrawers();
            });
            item.querySelector(".companion-edit").addEventListener("click", (e) => {
                e.stopPropagation();
                openCompanionEditor(c.id);
            });
            historyList.appendChild(item);
        });
    }

    // --- Projects: sidebar list, chats view, editor ------------------------
    function renderProjectList() {
        historyList.innerHTML = "";
        const i18n = window.BobigoI18n; const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);
        const addBtn = document.createElement("button");
        addBtn.type = "button"; addBtn.className = "companion-new-btn";
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${escapeHtml(t("newProject", "Dự án mới"))}`;
        addBtn.addEventListener("click", () => openProjectEditor(null));
        historyList.appendChild(addBtn);
        if (!projects.length) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = t("noProjects", "Chưa có dự án nào.");
            historyList.appendChild(empty);
            return;
        }
        projects.forEach((p) => {
            const chats = sessions.filter((s) => s.projectId === p.id).length;
            const item = document.createElement("div");
            item.className = "companion-card project-card";
            item.innerHTML = `
                <div class="project-icon" style="color:${escapeHtml(p.color || "#ef233c")}"><i class="fa-solid fa-folder"></i></div>
                <div class="companion-meta">
                    <div class="companion-name">${escapeHtml(p.name || "")}</div>
                    <div class="companion-tag">${chats} ${escapeHtml(t("projectChats", "đoạn chat"))}${(p.knowledge && p.knowledge.length) ? ` · ${p.knowledge.length} ${escapeHtml(t("knowledgeItems", "mục kiến thức"))}` : ""}</div>
                </div>
                <button type="button" class="companion-edit" title="${t("editProject", "Sửa")}"><i class="fa-solid fa-pen"></i></button>`;
            item.addEventListener("click", (e) => {
                if (e.target.closest(".companion-edit")) return;
                openProject(p.id);
            });
            item.querySelector(".companion-edit").addEventListener("click", (e) => { e.stopPropagation(); openProjectEditor(p.id); });
            historyList.appendChild(item);
        });
    }

    function openProject(id) {
        currentProjectId = id;
        const chats = sessions.filter((s) => s.projectId === id);
        if (chats.length) {
            currentSessionId = chats[0].id;
            renderSidebar();
            renderCurrentSession();
        } else {
            createProjectChat(id);
        }
    }

    function createProjectChat(projectId) {
        const s = {
            id: "session_" + Date.now(),
            title: config.language === "en" ? "New chat" : "Chat mới",
            createdAt: new Date().toISOString(),
            messages: [],
            projectId,
        };
        sessions.unshift(s);
        currentSessionId = s.id;
        localStorage.setItem("bobigo_sessions", JSON.stringify(sessions));
        renderSidebar();
        renderCurrentSession();
        if (isMobile()) closeAllDrawers();
    }

    function renderProjectChats() {
        historyList.innerHTML = "";
        const i18n = window.BobigoI18n; const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);
        const p = getCurrentProject();
        if (!p) { currentProjectId = null; renderProjectList(); return; }
        const header = document.createElement("div");
        header.className = "project-header";
        header.innerHTML = `
            <button type="button" class="project-back" title="${t("backToProjects", "Danh sách dự án")}"><i class="fa-solid fa-arrow-left"></i></button>
            <span class="project-title"><i class="fa-solid fa-folder" style="color:${escapeHtml(p.color || "#ef233c")}"></i> ${escapeHtml(p.name || "")}</span>
            <button type="button" class="project-edit-btn" title="${t("editProject", "Sửa dự án")}"><i class="fa-solid fa-sliders"></i></button>`;
        header.querySelector(".project-back").addEventListener("click", () => { currentProjectId = null; renderSidebar(); renderCurrentSession(); });
        header.querySelector(".project-edit-btn").addEventListener("click", () => openProjectEditor(p.id));
        historyList.appendChild(header);

        const addBtn = document.createElement("button");
        addBtn.type = "button"; addBtn.className = "companion-new-btn";
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${escapeHtml(t("newChatInProject", "Chat mới trong dự án"))}`;
        addBtn.addEventListener("click", () => createProjectChat(p.id));
        historyList.appendChild(addBtn);

        const chats = sessions.filter((s) => s.projectId === p.id);
        if (!chats.length) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = t("noProjectChats", "Chưa có chat nào.");
            historyList.appendChild(empty);
            return;
        }
        chats.forEach((session) => {
            const isGen = activeGenerations.has(session.id);
            const item = document.createElement("div");
            item.className = `history-item ${session.id === currentSessionId ? "active" : ""} ${isGen ? "is-generating" : ""}`;
            item.innerHTML = `
                <div class="history-title-wrap"><i class="fa-regular fa-message"></i>
                    <div><span class="history-item-title">${escapeHtml(session.title)}</span>
                    <span class="history-item-time">${relativeTime(session.createdAt, lang)}</span></div>
                </div>
                <i class="fa-solid fa-xmark history-delete-btn"></i>`;
            item.addEventListener("click", (e) => {
                if (e.target.classList.contains("history-delete-btn")) return;
                currentSessionId = session.id; renderSidebar(); renderCurrentSession();
                if (isMobile()) closeAllDrawers();
            });
            item.querySelector(".history-delete-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                sessions = sessions.filter((s) => s.id !== session.id);
                if (currentSessionId === session.id) {
                    const rest = sessions.filter((s) => s.projectId === p.id);
                    currentSessionId = rest.length ? rest[0].id : null;
                }
                localStorage.setItem("bobigo_sessions", JSON.stringify(sessions));
                renderSidebar(); renderCurrentSession();
            });
            historyList.appendChild(item);
        });
    }

    // --- Project editor (name, instructions, knowledge) --------------------
    const projectModal = document.getElementById("project-modal");
    const projectBody = document.getElementById("project-modal-body");
    document.getElementById("project-modal-close")?.addEventListener("click", closeProjectEditor);
    projectModal?.addEventListener("click", (e) => { if (e.target === projectModal) closeProjectEditor(); });
    document.getElementById("project-save-btn")?.addEventListener("click", saveProjectEditor);
    document.getElementById("project-delete-btn")?.addEventListener("click", deleteProjectEditor);
    function closeProjectEditor() { projectModal?.classList.add("hidden"); }

    function openProjectEditor(id) {
        if (!window.BobigoProjects || !projectModal || !projectBody) return;
        const i18n = window.BobigoI18n; const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);
        let p = projects.find((x) => x.id === id);
        const isNew = !p;
        if (!p) p = BobigoProjects.newProject({ language: lang });
        let knowledge = (p.knowledge || []).slice();
        document.getElementById("project-modal-title").textContent = isNew ? t("newProject", "Dự án mới") : t("editProject", "Sửa dự án");
        projectBody.innerHTML = `
            <div class="config-group"><label>${t("projectName", "Tên dự án")}</label><input id="p-name" value="${escapeHtml(p.name || "")}"></div>
            <div class="config-group"><label>${t("projectInstructions", "Hướng dẫn chung")}</label><textarea id="p-instructions" rows="4" placeholder="${t("projectInstructionsPh", "Cách Bobigo nên hỗ trợ trong dự án này…")}">${escapeHtml(p.instructions || "")}</textarea></div>
            <div class="config-group">
                <label>${t("projectKnowledge", "Kiến thức dự án")}</label>
                <div class="kn-list" id="p-knowledge"></div>
                <div class="kn-add">
                    <input id="p-kn-note" placeholder="${t("knowledgeNotePh", "Dán ghi chú / dữ kiện…")}">
                    <button type="button" class="btn-icon-sm" id="p-kn-add-btn" title="${t("addNote", "Thêm ghi chú")}"><i class="fa-solid fa-plus"></i></button>
                    <button type="button" class="btn-icon-sm" id="p-kn-file-btn" title="${t("uploadFile", "Tải tệp")}"><i class="fa-solid fa-paperclip"></i></button>
                    <input type="file" id="p-kn-file" accept=".pdf,.txt,.md,.json,.csv,.py,.js,.html,.css" style="display:none">
                </div>
            </div>`;
        function renderKn() {
            const el = document.getElementById("p-knowledge");
            el.innerHTML = knowledge.length
                ? knowledge.map((k) => `<div class="kn-item" data-kn="${k.id}"><span class="kn-name">${escapeHtml(k.name || "note")}</span><span class="kn-size">${(k.text || "").length} ch</span><button type="button" class="kn-del"><i class="fa-solid fa-xmark"></i></button></div>`).join("")
                : `<div class="kn-empty">${t("noKnowledge", "Chưa có. Thêm ghi chú hoặc tải tệp.")}</div>`;
            el.querySelectorAll(".kn-item").forEach((row) => row.querySelector(".kn-del").addEventListener("click", () => {
                knowledge = knowledge.filter((k) => k.id !== row.getAttribute("data-kn")); renderKn();
            }));
        }
        renderKn();
        document.getElementById("p-kn-add-btn").addEventListener("click", () => {
            const txt = (document.getElementById("p-kn-note").value || "").trim(); if (!txt) return;
            knowledge.push({ id: BobigoProjects.uid("kn"), name: txt.slice(0, 24) + (txt.length > 24 ? "…" : ""), text: txt, source: "note" });
            document.getElementById("p-kn-note").value = ""; renderKn();
        });
        document.getElementById("p-kn-file-btn").addEventListener("click", () => document.getElementById("p-kn-file").click());
        document.getElementById("p-kn-file").addEventListener("change", async (e) => {
            const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
            try {
                const fd = new FormData(); fd.append("file", f);
                const resp = await fetch("/api/extract-file", { method: "POST", body: fd });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || "extract failed");
                knowledge.push({ id: BobigoProjects.uid("kn"), name: f.name, text: data.text || "", source: "file" });
                renderKn();
            } catch (err) { alert(t("knowledgeFail", "Lỗi đọc tệp: ") + (err.message || err)); }
        });
        projectModal._draft = { p, isNew, getKnowledge: () => knowledge };
        projectModal.classList.remove("hidden");
        const delBtn = document.getElementById("project-delete-btn");
        if (delBtn) delBtn.style.display = isNew ? "none" : "";
    }

    function saveProjectEditor() {
        if (!projectModal || !projectModal._draft) return;
        const { p, isNew, getKnowledge } = projectModal._draft;
        p.name = (document.getElementById("p-name").value || "").trim() || (config.language === "en" ? "Project" : "Dự án");
        p.instructions = (document.getElementById("p-instructions").value || "").trim();
        p.knowledge = getKnowledge();
        if (isNew) projects.unshift(p);
        BobigoProjects.saveProjects(projects);
        closeProjectEditor();
        if (appMode !== "project") { setMode("project"); setNavActive(railProjectsBtn); }
        if (isNew) openProject(p.id); else { renderSidebar(); renderCurrentSession(); }
    }

    function deleteProjectEditor() {
        if (!projectModal || !projectModal._draft) return;
        const { p } = projectModal._draft;
        projects = projects.filter((x) => x.id !== p.id);
        BobigoProjects.saveProjects(projects);
        // orphan its chats back to plain chat list
        sessions.forEach((s) => { if (s.projectId === p.id) delete s.projectId; });
        localStorage.setItem("bobigo_sessions", JSON.stringify(sessions));
        if (currentProjectId === p.id) currentProjectId = null;
        closeProjectEditor();
        renderSidebar();
        renderCurrentSession();
    }

    function renderHistoryList(filterQuery = "") {
        closeChatMenu();
        historyList.innerHTML = "";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "companion-new-btn";
        addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> ${escapeHtml(t("newChat", "Cuộc trò chuyện mới"))}`;
        addBtn.addEventListener("click", () => {
            createNewSession(true);
            if (isMobile()) closeAllDrawers();
        });
        historyList.appendChild(addBtn);

        // The main chat list excludes chats that belong to a project.
        const base = sessions.filter(s => !s.projectId);
        let filtered = filterQuery
            ? base.filter(s => (s.title || "").toLowerCase().includes(filterQuery.toLowerCase()))
            : base;

        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = filterQuery ? (i18n ? i18n.t(lang, "noMatchChats") : "Không có cuộc trò chuyện khớp.") : (i18n ? i18n.t(lang, "noHistory") : "Chưa có lịch sử.");
            historyList.appendChild(empty);
            return;
        }

        // pinned chats float to the top (stable otherwise)
        filtered = filtered.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

        filtered.forEach(session => {
            const isGen = activeGenerations.has(session.id);
            const item = document.createElement("div");
            item.className = `history-item ${session.id === currentSessionId ? "active" : ""} ${isGen ? "is-generating" : ""} ${session.pinned ? "pinned" : ""}`;
            item.setAttribute("data-id", session.id);

            item.innerHTML = `
                <span class="hist-ic"><i class="fa-${session.pinned ? "solid fa-thumbtack" : "regular fa-message"}"></i></span>
                <div class="hist-text">
                    <span class="history-item-title">${escapeHtml(session.title || "")}</span>
                    <span class="history-item-time">${relativeTime(session.createdAt, lang)}</span>
                </div>
                <button type="button" class="hist-menu-btn" title="${t("moreActions", "Tùy chọn")}"><i class="fa-solid fa-ellipsis"></i></button>`;

            item.addEventListener("click", (e) => {
                if (e.target.closest(".hist-menu-btn")) return;
                if (item.querySelector(".hist-rename-input")) return;
                currentSessionId = session.id;
                renderHistoryList(filterQuery);
                renderCurrentSession();
                if (isMobile()) closeAllDrawers();
            });
            item.querySelector(".hist-menu-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                openChatMenu(e.currentTarget, session, filterQuery);
            });
            historyList.appendChild(item);
        });
    }

    // --- Chat item actions: menu, rename, pin, add-to-project --------------
    function closeChatMenu() { document.querySelectorAll(".chat-menu").forEach((m) => m.remove()); }

    function openChatMenu(anchor, session, filterQuery) {
        closeChatMenu();
        const i18n = window.BobigoI18n; const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);
        const menu = document.createElement("div");
        menu.className = "chat-menu";
        menu.innerHTML = `
            <button data-act="pin"><i class="fa-solid fa-thumbtack"></i><span>${session.pinned ? t("unpin", "Bỏ ghim") : t("pin", "Ghim")}</span><kbd>P</kbd></button>
            <button data-act="rename"><i class="fa-solid fa-pen"></i><span>${t("rename", "Đổi tên")}</span><kbd>F2</kbd></button>
            <button data-act="project"><i class="fa-solid fa-folder-plus"></i><span>${t("addToProject", "Thêm vào dự án")}</span><kbd>M</kbd></button>
            <div class="chat-menu-sep"></div>
            <button data-act="delete" class="danger"><i class="fa-regular fa-trash-can"></i><span>${t("del", "Xóa")}</span><kbd>⌫</kbd></button>`;
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const mw = menu.offsetWidth || 210;
        menu.style.top = Math.round(r.bottom + 4) + "px";
        menu.style.left = Math.round(Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))) + "px";
        menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => {
            e.stopPropagation();
            const act = b.getAttribute("data-act");
            const anc = anchor;
            closeChatMenu();
            if (act === "pin") togglePinSession(session.id);
            else if (act === "rename") startRenameSession(session.id);
            else if (act === "project") openProjectPicker(session, anc);
            else if (act === "delete") deleteSession(session.id);
        }));
        setTimeout(() => document.addEventListener("click", closeChatMenu, { once: true }), 0);
    }

    function togglePinSession(id) {
        const s = sessions.find((x) => x.id === id);
        if (!s) return;
        s.pinned = !s.pinned;
        saveSessions();
        renderHistoryList();
    }

    function startRenameSession(id) {
        openHistoryDrawer(); // make sure the item is visible to edit
        const item = historyList.querySelector(`.history-item[data-id="${id}"]`);
        const session = sessions.find((s) => s.id === id);
        if (!item || !session) return;
        const titleEl = item.querySelector(".history-item-title");
        if (!titleEl) return;
        const input = document.createElement("input");
        input.className = "hist-rename-input";
        input.value = session.title || "";
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const commit = (save) => {
            if (done) return;
            done = true;
            if (save) {
                const v = input.value.trim();
                if (v) session.title = v;
                saveSessions();
            }
            renderHistoryList();
            setModeLabel();
        };
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(true); }
            else if (e.key === "Escape") { e.preventDefault(); commit(false); }
        });
        input.addEventListener("blur", () => commit(true));
        input.addEventListener("click", (e) => e.stopPropagation());
    }

    function openProjectPicker(session, anchor) {
        closeChatMenu();
        if (!window.BobigoProjects) return;
        const i18n = window.BobigoI18n; const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);
        const menu = document.createElement("div");
        menu.className = "chat-menu project-picker";
        const items = projects.map((p) =>
            `<button data-pid="${p.id}"><i class="fa-solid fa-folder" style="color:${escapeHtml(p.color || "#ef233c")}"></i><span>${escapeHtml(p.name || "")}</span></button>`).join("");
        menu.innerHTML = (projects.length ? items : `<div class="chat-menu-empty">${t("noProjects", "Chưa có dự án")}</div>`)
            + `<div class="chat-menu-sep"></div><button data-pid="__new"><i class="fa-solid fa-plus"></i><span>${t("newProject", "Dự án mới")}</span></button>`;
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const mw = menu.offsetWidth || 220;
        menu.style.top = Math.round(r.bottom + 4) + "px";
        menu.style.left = Math.round(Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))) + "px";
        menu.querySelectorAll("button").forEach((b) => b.addEventListener("click", (e) => {
            e.stopPropagation();
            const pid = b.getAttribute("data-pid");
            closeChatMenu();
            if (pid === "__new") {
                const p = BobigoProjects.newProject({ language: config.language });
                projects.unshift(p);
                BobigoProjects.saveProjects(projects);
                session.projectId = p.id;
            } else {
                session.projectId = pid;
            }
            saveSessions();
            renderHistoryList();
        }));
        setTimeout(() => document.addEventListener("click", closeChatMenu, { once: true }), 0);
    }

    function deleteSession(id) {
        sessions = sessions.filter(s => s.id !== id);
        if (sessions.length === 0) {
            createNewSession(false);
        }
        if (currentSessionId === id) {
            currentSessionId = sessions[0].id;
        }
        saveSessions();
        renderHistoryList();
        renderCurrentSession();
    }

    function branchSessionFromMessage(sessionId, msgIndex) {
        const sourceSession = sessions.find(s => s.id === sessionId) || getActiveSession();
        if (!sourceSession || !sourceSession.messages || sourceSession.messages.length === 0) return;

        const sliceCount = Math.min(msgIndex + 1, sourceSession.messages.length);
        const branchedMessages = JSON.parse(JSON.stringify(sourceSession.messages.slice(0, sliceCount)));
        branchedMessages.forEach(m => delete m.isStreaming);

        const baseTitle = sourceSession.title || "Cuộc trò chuyện";
        const newTitle = `${baseTitle} (Nhánh ${sliceCount})`;

        const newSession = {
            id: "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
            title: newTitle,
            createdAt: new Date().toISOString(),
            messages: branchedMessages,
            mode: sourceSession.mode || appMode,
            world_id: sourceSession.world_id,
            memory: sourceSession.memory ? JSON.parse(JSON.stringify(sourceSession.memory)) : [],
        };

        sessions.unshift(newSession);
        currentSessionId = newSession.id;
        saveSessions();
        if (appMode === "companion") renderSidebar();
        else renderHistoryList();
        renderCurrentSession();
        if (isMobile()) closeAllDrawers();
    }

    function editUserMessageAndResubmit(sessionId, msgIndex, newText) {
        const session = sessions.find(s => s.id === sessionId) || getActiveSession();
        if (!session || !session.messages || msgIndex >= session.messages.length) return;

        const oldMsg = session.messages[msgIndex];
        const attachments = oldMsg.attachments || [];
        let attachContext = "";
        if (attachments.length > 0) {
            attachments.forEach(f => {
                attachContext += `\n\n--- TỆP ĐÍNH KÈM: ${f.filename} (${formatFileSize(f.size)}) ---\n${f.text || ""}\n--- HẾT NỘI DUNG TỆP ---\n`;
            });
        }

        const fullPrompt = newText.trim() + attachContext;

        session.messages = session.messages.slice(0, msgIndex);
        saveSessions();

        // Always re-render the truncated thread first, otherwise the stale DOM
        // rows stay while handleSendMessage appends the edited message → duplicate.
        if (currentSessionId !== sessionId) currentSessionId = sessionId;
        renderCurrentSession();

        handleSendMessage({
            text: newText.trim(),
            fullContent: fullPrompt,
            attachments: attachments,
            sessionId: sessionId,
        });
    }

    function handleRegenerateFromIndex(msgIndex, opts = {}) {
        const session = getActiveSession();
        if (!session || !session.messages || msgIndex >= session.messages.length) return;
        let userIndex = -1;
        for (let i = msgIndex - 1; i >= 0; i--) {
            if (session.messages[i].role === "user") {
                userIndex = i;
                break;
            }
        }
        if (userIndex === -1) return;
        const userMsg = session.messages[userIndex];
        // Keep the previous answer(s) so the new one becomes another comparable variant.
        const prev = session.messages[msgIndex];
        let priorVariants = [];
        if (prev && prev.role === "assistant") {
            priorVariants = Array.isArray(prev.variants) && prev.variants.length
                ? prev.variants.slice()
                : [prev.content];
        }
        session.messages = session.messages.slice(0, userIndex + 1);
        saveSessions();
        renderCurrentSession();
        handleSendMessage({
            regenerate: true,
            text: userMsg.text || userMsg.content,
            fullContent: userMsg.content,
            attachments: userMsg.attachments,
            sessionId: session.id,
            temperatureOverride: opts.temperatureOverride,
            priorVariants,
        });
    }

    function enterInlineEditMode(bubbleEl, initialText, msgIndex) {
        const originalHTML = bubbleEl.innerHTML;
        const i18n = window.BobigoI18n;
        const lang = (config && config.language) || "vi";
        const saveLabel = (i18n && i18n.t(lang, "saveAndSubmit")) || "Lưu & Gửi lại";
        const cancelLabel = (i18n && i18n.t(lang, "cancel")) || "Hủy";

        bubbleEl.innerHTML = `
            <div class="inline-edit-container">
                <textarea class="inline-edit-textarea" rows="3">${escapeHtml(initialText)}</textarea>
                <div class="inline-edit-actions">
                    <button type="button" class="btn-glass-sm inline-cancel-btn">${escapeHtml(cancelLabel)}</button>
                    <button type="button" class="btn-brand-sm inline-save-btn"><i class="fa-solid fa-paper-plane"></i> ${escapeHtml(saveLabel)}</button>
                </div>
            </div>
        `;

        const textarea = bubbleEl.querySelector(".inline-edit-textarea");
        const cancelBtn = bubbleEl.querySelector(".inline-cancel-btn");
        const saveBtn = bubbleEl.querySelector(".inline-save-btn");

        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;

        cancelBtn.addEventListener("click", () => {
            bubbleEl.innerHTML = originalHTML;
            enhanceMarkdownElements(bubbleEl);
        });

        saveBtn.addEventListener("click", () => {
            const newText = textarea.value.trim();
            if (!newText) return;
            editUserMessageAndResubmit(currentSessionId, msgIndex, newText);
        });

        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                bubbleEl.innerHTML = originalHTML;
                enhanceMarkdownElements(bubbleEl);
            }
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const newText = textarea.value.trim();
                if (!newText) return;
                editUserMessageAndResubmit(currentSessionId, msgIndex, newText);
            }
        });
    }

    function renderCurrentSession() {
        const session = getActiveSession();
        messagesContainer.innerHTML = "";
        setModeLabel();

        if (!session) {
            // Companion mode with no companion selected yet — show create prompt.
            applyWelcomeCopy();
            messagesContainer.appendChild(welcomeScreen);
            welcomeScreen.style.display = "block";
            setGenerating(false);
            updateContextMeter();
            return;
        }

        const isThisSessionGenerating = activeGenerations.has(session.id);
        setGenerating(isThisSessionGenerating);

        if (!session.messages || session.messages.length === 0) {
            applyWelcomeCopy(); // refresh welcome for the active companion/mode
            messagesContainer.appendChild(welcomeScreen);
            welcomeScreen.style.display = "block";
        } else {
            welcomeScreen.style.display = "none";
            session.messages.forEach((msg, idx) => {
                if (msg.summary) {
                    messagesContainer.appendChild(createSummaryElement(msg));
                    return;
                }
                const isMsgStreaming = (idx === session.messages.length - 1 && isThisSessionGenerating);
                const msgEl = createMessageElement(msg.role, msg.content, msg.reasoning, msg.searchResults, msg.toolEvents, msg.attachments, msg.text, idx, isMsgStreaming);
                if (msg.pinned) msgEl.classList.add("pinned");
                if (msg.role === "assistant" && Array.isArray(msg.variants) && msg.variants.length > 1) {
                    const stackEl = msgEl.querySelector(".message-stack");
                    if (stackEl) stackEl.appendChild(buildVariantSwitcher(msg));
                }
                messagesContainer.appendChild(msgEl);
            });
            scrollToBottom();
        }
        updateContextMeter();
    }

    function makePinButton(msgIndex) {
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const session = getActiveSession();
        const pinned = !!(session && session.messages[msgIndex] && session.messages[msgIndex].pinned);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "msg-action-btn pin-msg-btn" + (pinned ? " active" : "");
        btn.title = (i18n && i18n.t(lang, pinned ? "unpin" : "pin")) || (pinned ? "Bỏ ghim" : "Ghim");
        btn.innerHTML = '<i class="fa-solid fa-thumbtack"></i>';
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const s = getActiveSession();
            const m = s && s.messages[msgIndex];
            if (!m) return;
            m.pinned = !m.pinned;
            saveSessions();
            renderCurrentSession();
        });
        return btn;
    }

    function openRegenMenu(anchor, msgIndex) {
        document.querySelectorAll(".regen-menu").forEach((m) => m.remove());
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const base = config.temperature;
        const choices = [
            { label: (i18n && i18n.t(lang, "regenSame")) || "Tạo lại", t: undefined },
            { label: (i18n && i18n.t(lang, "regenCreative")) || "Sáng tạo hơn", t: Math.min(1.5, base + 0.3) },
            { label: (i18n && i18n.t(lang, "regenPrecise")) || "Chính xác hơn", t: Math.max(0, base - 0.3) },
        ];
        const menu = document.createElement("div");
        menu.className = "regen-menu";
        menu.innerHTML = choices.map((c, i) => `<button type="button" data-i="${i}">${escapeHtml(c.label)}</button>`).join("");
        menu.querySelectorAll("button").forEach((b) => {
            b.addEventListener("click", (e) => {
                e.stopPropagation();
                const i = parseInt(b.getAttribute("data-i"), 10);
                menu.remove();
                handleRegenerateFromIndex(msgIndex, { temperatureOverride: choices[i].t });
            });
        });
        // Anchor to the viewport so the hover-only .msg-actions opacity can't hide it.
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const mw = menu.offsetWidth || 160;
        const left = Math.min(r.left, window.innerWidth - mw - 8);
        menu.style.top = Math.round(r.bottom + 4) + "px";
        menu.style.left = Math.round(Math.max(8, left)) + "px";
        setTimeout(() => {
            document.addEventListener("click", function h() {
                menu.remove();
                document.removeEventListener("click", h);
            });
        }, 0);
    }

    function buildVariantSwitcher(msg) {
        const n = msg.variants.length;
        let cur = typeof msg.activeVariant === "number" ? msg.activeVariant : n - 1;
        const wrap = document.createElement("div");
        wrap.className = "variant-switcher";
        wrap.innerHTML = `<button type="button" class="var-prev" title="prev">‹</button><span class="var-count">${cur + 1}/${n}</span><button type="button" class="var-next" title="next">›</button>`;
        const go = (dir) => {
            cur = (cur + dir + n) % n;
            msg.activeVariant = cur;
            msg.content = msg.variants[cur];
            saveSessions();
            renderCurrentSession();
        };
        wrap.querySelector(".var-prev").addEventListener("click", () => go(-1));
        wrap.querySelector(".var-next").addEventListener("click", () => go(1));
        return wrap;
    }

    function createSummaryElement(msg) {
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const title = (i18n && i18n.t(lang, "compressedTitle")) || "Đã nén hội thoại cũ";
        const row = document.createElement("div");
        row.className = "summary-row";
        const body = String(msg.content || "").replace(/^\[[^\]]*\]\n?/, "");
        row.innerHTML = `
            <details class="summary-card">
                <summary><i class="fa-solid fa-compress"></i> ${escapeHtml(title)} (${msg.count || ""})</summary>
                <div class="summary-content">${renderMarkdown(body)}</div>
            </details>`;
        return row;
    }

    // --------------------------------------------------------------------------
    // File & PDF Attachment Logic
    // --------------------------------------------------------------------------
    function renderAttachmentChips() {
        if (!attachmentPreviewBar) return;
        if (!attachedFiles || attachedFiles.length === 0) {
            attachmentPreviewBar.classList.add("hidden");
            attachmentPreviewBar.innerHTML = "";
            return;
        }
        attachmentPreviewBar.classList.remove("hidden");
        attachmentPreviewBar.innerHTML = "";
        attachedFiles.forEach((file, index) => {
            const chip = document.createElement("div");
            chip.className = "attachment-chip";
            const iconClass = file.isPdf ? "fa-solid fa-file-pdf file-icon pdf" : (file.isCode ? "fa-solid fa-file-code file-icon code" : "fa-solid fa-file-lines file-icon text");
            chip.innerHTML = `
                <i class="${iconClass}"></i>
                <span class="file-name" title="${escapeHtml(file.filename)}">${escapeHtml(file.filename)}</span>
                <span class="file-size">${formatFileSize(file.size)}</span>
                <button type="button" class="attachment-chip-remove" title="Gỡ tệp" data-index="${index}">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
            chip.querySelector(".attachment-chip-remove").addEventListener("click", (e) => {
                e.stopPropagation();
                attachedFiles.splice(index, 1);
                renderAttachmentChips();
                if (userInput.value.trim() === "" && attachedFiles.length === 0) {
                    sendBtn.disabled = true;
                }
            });
            attachmentPreviewBar.appendChild(chip);
        });
    }

    attachFileBtn.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const maxBytes = 25 * 1024 * 1024; // 25 MB
        if (file.size > maxBytes) {
            alert("Tệp quá lớn (tối đa 25MB). Hãy chọn file nhỏ hơn.");
            fileInput.value = "";
            return;
        }

        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        const codeExts = [".py", ".js", ".html", ".css", ".json", ".sql", ".sh", ".c", ".cpp", ".rs", ".go", ".java", ".php", ".rb", ".swift", ".kt"];
        const isCode = codeExts.some(ext => file.name.toLowerCase().endsWith(ext));

        // Show spinner on attach button
        attachFileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        attachFileBtn.disabled = true;

        try {
            if (isPdf || file.size > 150 * 1024) {
                // Send to backend extractor
                const formData = new FormData();
                formData.append("file", file);
                const resp = await fetch("/api/extract-file", {
                    method: "POST",
                    body: formData,
                });
                if (!resp.ok) {
                    const errJson = await resp.json().catch(() => ({}));
                    throw new Error(errJson.error || `HTTP ${resp.status}`);
                }
                const data = await resp.json();
                attachedFiles.push({
                    filename: file.name,
                    size: file.size,
                    text: data.text || "",
                    isPdf: isPdf,
                    isCode: isCode,
                });
            } else {
                // Read text directly
                const text = await file.text();
                attachedFiles.push({
                    filename: file.name,
                    size: file.size,
                    text: text,
                    isPdf: false,
                    isCode: isCode,
                });
            }
            renderAttachmentChips();
            sendBtn.disabled = false;
        } catch (err) {
            alert(`Lỗi đọc tệp ${file.name}: ${err.message}`);
        } finally {
            attachFileBtn.innerHTML = '<i class="fa-solid fa-paperclip"></i>';
            attachFileBtn.disabled = false;
            fileInput.value = "";
        }
    });

    // --------------------------------------------------------------------------
    // User Input & Chat Form Handler
    // --------------------------------------------------------------------------
    function setGenerating(on) {
        isGenerating = on;
        sendBtn.classList.toggle("is-stop", on);
        sendBtn.title = on ? "Dừng (Esc)" : "Gửi (Enter)";
        const sendIcon = sendBtn.querySelector(".send-icon");
        const stopIcon = sendBtn.querySelector(".stop-icon");
        if (sendIcon) sendIcon.style.display = on ? "none" : "";
        if (stopIcon) stopIcon.style.display = on ? "" : "none";
        if (on) {
            sendBtn.disabled = false;
        } else {
            sendBtn.disabled = (userInput.value.trim() === "" && (!attachedFiles || attachedFiles.length === 0)) || !llmReady;
        }
    }

    function stopGeneration() {
        if (activeGenerations.has(currentSessionId)) {
            const gen = activeGenerations.get(currentSessionId);
            if (gen && gen.abortController) {
                gen.abortController.abort();
            }
        }
        if (abortController) {
            abortController.abort();
        }
    }

    userInput.addEventListener("input", () => {
        userInput.style.height = "auto";
        userInput.style.height = `${Math.min(userInput.scrollHeight, 128)}px`;
        if (!isGenerating) {
            sendBtn.disabled = (userInput.value.trim() === "" && (!attachedFiles || attachedFiles.length === 0)) || !llmReady;
        }
    });

    userInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && (isGenerating || activeGenerations.has(currentSessionId))) {
            e.preventDefault();
            stopGeneration();
            return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!isGenerating && (userInput.value.trim() !== "" || (attachedFiles && attachedFiles.length > 0))) {
                handleSendMessage();
            }
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && (isGenerating || activeGenerations.has(currentSessionId))) {
            stopGeneration();
        }
    });

    sendBtn.addEventListener("click", () => {
        if (isGenerating || activeGenerations.has(currentSessionId)) {
            stopGeneration();
            return;
        }
        if (userInput.value.trim() !== "" || (attachedFiles && attachedFiles.length > 0)) {
            handleSendMessage();
        }
    });

    suggestionCards.forEach((card) => {
        card.addEventListener("click", () => {
            if (isGenerating) return;
            const prompt = card.getAttribute("data-prompt");
            if (prompt) {
                userInput.value = prompt;
                userInput.style.height = "auto";
                sendBtn.disabled = false;
                handleSendMessage();
            }
        });
    });

    async function handleRegenerate() {
        const session = getActiveSession();
        if (!session || !session.messages || !session.messages.length) return;
        handleRegenerateFromIndex(session.messages.length - 1);
    }

    async function handleSendMessage(opts) {
        const regen = !!(opts && opts.regenerate);
        // Edits and regenerations carry their text in opts.text; only a fresh
        // send reads the composer. (Previously non-regen always read the
        // composer, so editing a message picked up stale/empty composer text.)
        let rawText = (opts && typeof opts.text === "string")
            ? opts.text.trim()
            : userInput.value.trim();
        if (!rawText && (!attachedFiles || attachedFiles.length === 0) && !(opts && opts.fullContent)) return;

        if (appMode === "project" && currentProjectId && !getActiveSession()) {
            createProjectChat(currentProjectId); // ensure a chat exists before sending
        }
        const targetSession = (opts && opts.sessionId) ? (sessions.find(s => s.id === opts.sessionId) || getActiveSession()) : getActiveSession();
        if (!targetSession) {
            // Companion mode with none created yet — open the editor instead.
            if (appMode === "companion" && typeof openCompanionEditor === "function") openCompanionEditor(null);
            return;
        }
        const targetSessionId = targetSession.id;

        if (activeGenerations.has(targetSessionId)) return;

        if (!llmReady) {
            applyHealth({
                llm_ready: false,
                message: "Mô hình chưa sẵn sàng. Đợi chấm trạng thái chuyển xanh rồi gửi lại.",
            });
            return;
        }

        const attachmentsMeta = (opts && opts.attachments) ? opts.attachments : [];
        let attachContext = "";
        if (!regen && !opts?.fullContent && attachedFiles && attachedFiles.length > 0) {
            attachedFiles.forEach((f) => {
                attachmentsMeta.push({
                    filename: f.filename,
                    size: f.size,
                    isPdf: f.isPdf,
                    isCode: f.isCode,
                });
                attachContext += `\n\n--- TỆP ĐÍNH KÈM: ${f.filename} (${formatFileSize(f.size)}) ---\n${f.text}\n--- HẾT NỘI DUNG TỆP ---\n`;
            });
            attachedFiles = [];
            renderAttachmentChips();
        }

        const cleanPrompt = rawText.trim();
        const fullPromptContent = opts && opts.fullContent ? opts.fullContent : ((cleanPrompt || "Hãy đọc, phân tích và tóm tắt tài liệu đính kèm sau:") + attachContext);

        // Update Title on First Message
        if (!regen && targetSession.messages.length === 0) {
            const titleSource = cleanPrompt || "Đọc tài liệu";
            targetSession.title = titleSource.length > 28 ? titleSource.substring(0, 28) + "..." : titleSource;
            saveSessions();
            if (appMode === "companion") renderSidebar();
            else renderHistoryList();
        }

        if (welcomeScreen && welcomeScreen.parentElement) {
            welcomeScreen.style.display = "none";
        }

        // Clear the composer only for a fresh send — never for edits/regens,
        // which carry their own text and shouldn't wipe the user's draft.
        const fromComposer = !regen && !(opts && typeof opts.text === "string");
        if (fromComposer && currentSessionId === targetSessionId) {
            userInput.value = "";
            userInput.style.height = "auto";
        }

        const sessionAbortController = new AbortController();
        if (currentSessionId === targetSessionId) {
            abortController = sessionAbortController;
            setGenerating(true);
        }

        const userMsg = {
            role: "user",
            content: fullPromptContent,
            text: cleanPrompt,
            attachments: attachmentsMeta.length > 0 ? attachmentsMeta : undefined,
        };
        if (!regen) {
            targetSession.messages.push(userMsg);
            saveSessions();
            if (currentSessionId === targetSessionId) {
                appendMessageUI("user", fullPromptContent, "", null, null, attachmentsMeta, cleanPrompt, targetSession.messages.length - 1);
            }
        }

        // Auto-compress older turns when the window is nearly full (persisted once).
        await maybeAutoCompress(targetSession);

        // --- Web Search Phase (only when agent tools are off) ---
        let searchResults = [];
        let searchContextText = "";
        if (config.webSearch && config.agentTools === false && appMode !== "companion") {
            const searchQuery = refineSearchQuery(cleanPrompt || "tìm kiếm thông tin");
            let searchingRow = null;
            if (currentSessionId === targetSessionId) {
                searchingRow = createMessageElement("assistant", "");
                const searchingBubble = searchingRow.querySelector(".bubble");
                searchingBubble.innerHTML = `<span style="color: #10b981;"><i class="fa-solid fa-globe fa-spin"></i> Đang tìm kiếm: ${escapeHtml(searchQuery)}</span>`;
                messagesContainer.appendChild(searchingRow);
                scrollToBottom();
            }

            try {
                searchResults = await performWebSearch(searchQuery, sessionAbortController.signal);
                searchContextText = formatSearchResultsForContext(searchResults);
            } catch (err) {
                if (err.name === "AbortError") {
                    if (searchingRow && searchingRow.parentElement) messagesContainer.removeChild(searchingRow);
                    if (currentSessionId === targetSessionId) setGenerating(false);
                    return;
                }
                throw err;
            }

            if (searchingRow && searchingRow.parentElement) messagesContainer.removeChild(searchingRow);
        }

        // Assistant Streaming Placeholder
        const assistantMsgObj = {
            role: "assistant",
            content: "",
            reasoning: "",
            searchResults: searchResults.length > 0 ? searchResults : undefined,
            toolEvents: [],
            isStreaming: true,
        };
        targetSession.messages.push(assistantMsgObj);
        saveSessions();

        activeGenerations.set(targetSessionId, {
            abortController: sessionAbortController,
            assistantMsgObj: assistantMsgObj,
            targetSession: targetSession,
        });

        let streamingBubble = null;
        if (currentSessionId === targetSessionId) {
            const streamingRow = appendMessageUI("assistant", "", "", searchResults, null, null, null, targetSession.messages.length - 1, true);
            streamingBubble = streamingRow ? streamingRow.querySelector(".bubble") : null;
        }

        // Update sidebar generating badge
        if (appMode === "companion") renderSidebar();
        else renderHistoryList();

        // Build Payload
        let messageContext = [];
        if (config.memory) {
            messageContext = targetSession.messages.slice(0, targetSession.messages.length - 1).map(m => ({ role: m.role, content: m.content }));
        } else {
            messageContext = [userMsg];
        }

        if (searchContextText && messageContext.length > 0) {
            const lastIdx = messageContext.length - 1;
            messageContext[lastIdx] = {
                role: "user",
                content: messageContext[lastIdx].content + searchContextText
            };
        }

        const isCompanion = appMode === "companion";
        let systemContent;
        if (isCompanion) {
            systemContent = window.BobigoCompanions
                ? BobigoCompanions.buildSystemPrompt(targetSession, { contextWindow: contextInfo.window, reserve: contextInfo.reserve })
                : "";
        } else {
            systemContent = config.systemPrompt || "";
            const proj = targetSession.projectId && window.BobigoProjects ? projects.find((p) => p.id === targetSession.projectId) : null;
            if (proj) {
                const ctx = BobigoProjects.buildContext(proj, { contextWindow: contextInfo.window, reserve: contextInfo.reserve, language: config.language });
                systemContent = (systemContent + "\n\n" + ctx).trim();
            }
        }
        const messagesPayload = [{ role: "system", content: systemContent }, ...messageContext];

        const temperature = (opts && typeof opts.temperatureOverride === "number")
            ? opts.temperatureOverride
            : config.temperature;
        const payload = {
            model: currentModel,
            messages: messagesPayload,
            temperature: temperature,
            top_p: config.topP,
            repeat_penalty: config.repeatPenalty,
            max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined,
            stream: true,
            agent_tools: config.agentTools !== false,
            mode: "chat",
        };

        let fullReasoning = "";
        let fullAssistantContent = "";
        let toolEvents = [];

        // --- Throttled live rendering ---------------------------------------
        // Re-parsing the whole accumulated answer on every SSE token is O(n²)
        // and re-highlighting each code block per token made long replies lag.
        // We coalesce updates into one paint per animation frame, do only a
        // lightweight markdown pass while streaming, and leave the full
        // enhancement (code cards + hljs) to renderCurrentSession() in finally.
        let pendingRender = false;
        let streamDone = false;
        const streamStartTime = performance.now();

        function getLiveBubble() {
            // Cached ref is fastest; re-acquire if a re-render detached it
            // (e.g. the user switched away and back mid-stream).
            if (streamingBubble && streamingBubble.isConnected) return streamingBubble;
            const row = messagesContainer.querySelector(".message-row.assistant:last-child");
            streamingBubble = row ? row.querySelector(".bubble") : null;
            return streamingBubble;
        }

        function buildLiveHTML() {
            let htmlOutput = "";
            if (searchResults.length > 0) {
                htmlOutput += buildSearchResultsHTML(searchResults);
            }
            if (toolEvents.length > 0) {
                htmlOutput += buildToolEventsHTML(toolEvents, false);
            }
            if (config.showReasoning && fullReasoning) {
                const i18n = window.BobigoI18n;
                const lang = config.language || "vi";
                const thinkTitle = (i18n && i18n.t(lang, "thinkingProgress")) || "Tiến trình suy luận";
                htmlOutput += `<details class="thinking-box" open>
                    <summary><i class="fa-solid fa-brain"></i> ${escapeHtml(thinkTitle)}</summary>
                    <div class="thinking-content">${renderMarkdown(fullReasoning)}</div>
                </details>`;
            }
            if (fullAssistantContent) {
                htmlOutput += `<div class="response-content">${renderMarkdown(fullAssistantContent)}</div>`;
            } else if (!fullReasoning && toolEvents.length === 0) {
                const i18n = window.BobigoI18n;
                const lang = config.language || "vi";
                const thinkPh = (i18n && i18n.t(lang, "thinkingPlaceholder")) || "Đang suy nghĩ…";
                htmlOutput += `<span class="cursor-typing">${escapeHtml(thinkPh)}</span>`;
            }
            return htmlOutput;
        }

        function scheduleLiveRender() {
            if (currentSessionId !== targetSessionId || pendingRender) return;
            pendingRender = true;
            requestAnimationFrame(() => {
                pendingRender = false;
                // Once the stream is done, renderCurrentSession() owns the final
                // (fully enhanced) DOM — don't clobber it with a light pass.
                if (streamDone || currentSessionId !== targetSessionId) return;
                const liveBubble = getLiveBubble();
                if (!liveBubble) return;
                liveBubble.innerHTML = buildLiveHTML();
                scrollToBottom();
            });
        }

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: sessionAbortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop();

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
                        try {
                            const json = JSON.parse(trimmed.substring(6));
                            const deltaObj = json.choices[0]?.delta || {};

                            const reasoningDelta = deltaObj.reasoning_content || "";
                            const contentDelta = deltaObj.content || "";
                            const incomingTools = deltaObj.tool_events;

                            if (reasoningDelta) fullReasoning += reasoningDelta;
                            if (contentDelta) fullAssistantContent += contentDelta;
                            if (Array.isArray(incomingTools) && incomingTools.length) {
                                toolEvents = toolEvents.concat(incomingTools);
                            }

                            // Keep in-memory message synchronized
                            assistantMsgObj.content = fullAssistantContent;
                            assistantMsgObj.reasoning = fullReasoning;
                            assistantMsgObj.toolEvents = toolEvents;

                            scheduleLiveRender();

                        } catch (err) {
                            console.error("JSON parse error", err);
                        }
                    }
                }
            }

            assistantMsgObj.content = fullAssistantContent;
            assistantMsgObj.reasoning = fullReasoning;
            assistantMsgObj.toolEvents = toolEvents;

            // Regeneration: keep prior answers as switchable variants for comparison.
            if (opts && Array.isArray(opts.priorVariants) && opts.priorVariants.length) {
                assistantMsgObj.variants = [...opts.priorVariants, fullAssistantContent];
                assistantMsgObj.activeVariant = assistantMsgObj.variants.length - 1;
            }

        } catch (error) {
            const i18n = window.BobigoI18n;
            const lang = config.language || "vi";
            if (error.name === "AbortError") {
                const stopLabel = (i18n && i18n.t(lang, "stopped")) || "*Đã dừng.*";
                const stopped = fullAssistantContent
                    ? `${fullAssistantContent}\n\n${stopLabel}`
                    : stopLabel;
                assistantMsgObj.content = stopped;
            } else {
                const errTitle = (i18n && i18n.t(lang, "modelError")) || "Lỗi kết nối mô hình";
                assistantMsgObj.content = `[${errTitle}: ${error.message || String(error)}]`;
            }
        } finally {
            streamDone = true;
            delete assistantMsgObj.isStreaming;
            activeGenerations.delete(targetSessionId);

            const durationSec = (performance.now() - streamStartTime) / 1000;
            const totalChars = (fullAssistantContent || "").length + (fullReasoning || "").length;
            if (durationSec > 0.3 && totalChars > 0) {
                const estTokens = estimateTokens(fullAssistantContent + fullReasoning);
                const tps = (estTokens / durationSec).toFixed(1);
                localStorage.setItem("bobigo_last_tps", tps);
                updateHealthSpeedDisplay(tps);
            }

            saveSessions();

            if (currentSessionId === targetSessionId) {
                setGenerating(false);
                renderCurrentSession();
            }
            if (appMode === "companion") renderSidebar();
            else renderHistoryList();
        }
    }

    function parseUserMessageContent(rawContent, msgAttachments, msgUserText) {
        if (msgAttachments && msgAttachments.length > 0) {
            return {
                text: msgUserText !== undefined ? msgUserText : rawContent,
                attachments: msgAttachments,
            };
        }
        if (rawContent && rawContent.includes("--- TỆP ĐÍNH KÈM:")) {
            const attachRegex = /--- TỆP ĐÍNH KÈM:\s*(.*?)\s*\((.*?)\)\s*---\n([\s\S]*?)--- HẾT NỘI DUNG TỆP ---/g;
            const atts = [];
            let match;
            while ((match = attachRegex.exec(rawContent)) !== null) {
                const filename = match[1].trim();
                const sizeStr = match[2].trim();
                const isPdf = filename.toLowerCase().endsWith(".pdf");
                const codeExts = [".py", ".js", ".html", ".css", ".json", ".sql", ".sh", ".c", ".cpp", ".rs", ".go", ".java", ".php", ".rb", ".swift", ".kt"];
                const isCode = codeExts.some((ext) => filename.toLowerCase().endsWith(ext));
                atts.push({
                    filename,
                    sizeStr,
                    isPdf,
                    isCode,
                });
            }
            const cleanText = rawContent.replace(/--- TỆP ĐÍNH KÈM:\s*[\s\S]*?--- HẾT NỘI DUNG TỆP ---\n?/g, "").trim();
            return {
                text: cleanText,
                attachments: atts,
            };
        }
        return { text: rawContent || "", attachments: [] };
    }

    function appendMessageUI(role, content, reasoning = "", searchResults = null, toolEvents = null, attachments = null, userText = null, msgIndex = null, isStreaming = false) {
        const msgEl = createMessageElement(role, content, reasoning, searchResults, toolEvents, attachments, userText, msgIndex, isStreaming);
        messagesContainer.appendChild(msgEl);
        scrollToBottom();
        return msgEl;
    }

    function createMessageElement(role, content, reasoning = "", searchResults = null, toolEvents = null, attachments = null, userText = null, msgIndex = null, isStreaming = false) {
        const row = document.createElement("div");
        row.className = `message-row ${role}`;

        const avatar = document.createElement("div");
        avatar.className = "avatar-badge";
        avatar.innerHTML = role === "user" 
            ? '<i class="fa-solid fa-user"></i>' 
            : '<img src="logo.png" alt="Bobigo" class="avatar-img">';

        const stack = document.createElement("div");
        stack.className = "message-stack";

        const bubble = document.createElement("div");
        bubble.className = `bubble ${isStreaming ? "cursor-typing" : ""}`;

        let htmlOutput = "";

        // Search results card
        if (searchResults && searchResults.length > 0) {
            htmlOutput += buildSearchResultsHTML(searchResults);
            if (!isStreaming) htmlOutput = htmlOutput.replace(' open', '');
        }

        if (toolEvents && toolEvents.length > 0) {
            htmlOutput += buildToolEventsHTML(toolEvents, !isStreaming);
        }

        if (reasoning && config.showReasoning) {
            const i18n = window.BobigoI18n;
            const lang = config.language || "vi";
            const thinkTitle = (i18n && i18n.t(lang, "thinkingProgress")) || "Tiến trình suy luận";
            htmlOutput += `<details class="thinking-box" ${isStreaming ? "open" : ""}>
                <summary><i class="fa-solid fa-brain"></i> ${escapeHtml(thinkTitle)}</summary>
                <div class="thinking-content">${renderMarkdown(reasoning)}</div>
            </details>`;
        }

        let parsedUser = { text: content || "", attachments: [] };

        if (content || (attachments && attachments.length > 0)) {
            if (role === "user") {
                parsedUser = parseUserMessageContent(content, attachments, userText);
                let userHtml = "";
                if (parsedUser.attachments && parsedUser.attachments.length > 0) {
                    userHtml += '<div class="user-attachments-grid">';
                    parsedUser.attachments.forEach((att) => {
                        const iconType = att.isPdf ? "pdf" : (att.isCode ? "code" : "text");
                        const iconClass = att.isPdf ? "fa-solid fa-file-pdf" : (att.isCode ? "fa-solid fa-file-code" : "fa-solid fa-file-lines");
                        const typeLabel = att.isPdf ? "PDF" : (att.isCode ? "Mã nguồn" : "Tài liệu");
                        const sizeLabel = att.sizeStr || (att.size ? formatFileSize(att.size) : "");
                        userHtml += `
                            <div class="user-attachment-card">
                                <div class="uac-icon ${iconType}">
                                    <i class="${iconClass}"></i>
                                </div>
                                <div class="uac-info">
                                    <div class="uac-name" title="${escapeHtml(att.filename)}">${escapeHtml(att.filename)}</div>
                                    <div class="uac-meta">${typeLabel}${sizeLabel ? ` · ${sizeLabel}` : ""}</div>
                                </div>
                            </div>
                        `;
                    });
                    userHtml += '</div>';
                }
                if (parsedUser.text) {
                    userHtml += `<div class="user-prompt-text">${escapeHtml(parsedUser.text)}</div>`;
                }
                htmlOutput += userHtml;
            } else {
                htmlOutput += `<div class="response-content">${renderMarkdown(content)}</div>`;
            }
        }

        bubble.innerHTML = htmlOutput;
        enhanceMarkdownElements(bubble);
        stack.appendChild(bubble);

        // Actions bar on hover
        const actions = document.createElement("div");
        actions.className = "msg-actions";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";

        if (role === "user") {
            // Edit Prompt Button
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "msg-action-btn edit-msg-btn";
            editBtn.title = i18n ? i18n.t(lang, "editPrompt") : "Chỉnh sửa tin nhắn";
            editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
            editBtn.addEventListener("click", () => {
                enterInlineEditMode(bubble, parsedUser.text || content, msgIndex);
            });
            actions.appendChild(editBtn);

            // Branch Chat Button
            const branchBtn = document.createElement("button");
            branchBtn.type = "button";
            branchBtn.className = "msg-action-btn branch-msg-btn";
            branchBtn.title = i18n ? i18n.t(lang, "branchChat") : "Rẽ nhánh từ đây";
            branchBtn.innerHTML = '<i class="fa-solid fa-code-branch"></i>';
            branchBtn.addEventListener("click", () => {
                branchSessionFromMessage(currentSessionId, msgIndex);
            });
            actions.appendChild(branchBtn);

            // Copy Prompt Button
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "msg-action-btn";
            copyBtn.title = i18n ? i18n.t(lang, "copy") : "Sao chép";
            copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
            copyBtn.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(parsedUser.text || content);
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 1200);
                } catch (err) {
                    console.error(err);
                }
            });
            actions.appendChild(copyBtn);
            if (msgIndex !== null) actions.appendChild(makePinButton(msgIndex));
            stack.appendChild(actions);

        } else if (role === "assistant" && content) {
            // Branch Chat Button
            const branchBtn = document.createElement("button");
            branchBtn.type = "button";
            branchBtn.className = "msg-action-btn branch-msg-btn";
            branchBtn.title = i18n ? i18n.t(lang, "branchChat") : "Rẽ nhánh từ đây";
            branchBtn.innerHTML = '<i class="fa-solid fa-code-branch"></i>';
            branchBtn.addEventListener("click", () => {
                branchSessionFromMessage(currentSessionId, msgIndex);
            });
            actions.appendChild(branchBtn);

            // Regenerate Button
            const regenBtn = document.createElement("button");
            regenBtn.type = "button";
            regenBtn.className = "msg-action-btn regen-btn";
            regenBtn.title = i18n ? i18n.t(lang, "regen") : "Tạo lại";
            regenBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
            regenBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                openRegenMenu(regenBtn, msgIndex);
            });
            actions.appendChild(regenBtn);

            // Copy Button
            const copyBtn = document.createElement("button");
            copyBtn.type = "button";
            copyBtn.className = "msg-action-btn";
            copyBtn.title = i18n ? i18n.t(lang, "copy") : "Sao chép";
            copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>';
            copyBtn.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(content);
                    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    setTimeout(() => { copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>'; }, 1200);
                } catch (err) {
                    console.error(err);
                }
            });
            actions.appendChild(copyBtn);
            if (msgIndex !== null) actions.appendChild(makePinButton(msgIndex));
            stack.appendChild(actions);
        }

        row.appendChild(avatar);
        row.appendChild(stack);
        return row;
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // --------------------------------------------------------------------------
    // Export Functionality
    // --------------------------------------------------------------------------
    exportDropdownBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        exportMenu.classList.toggle("show");
    });

    document.addEventListener("click", () => {
        exportMenu.classList.remove("show");
    });

    exportMdBtn.addEventListener("click", () => {
        const session = getActiveSession();
        let markdownContent = `# ${session.title}\n*Xuất từ Bobigo Studio vào ${new Date().toLocaleString()}*\n\n---\n\n`;

        session.messages.forEach(msg => {
            markdownContent += `### ${msg.role === "user" ? "Người dùng" : "Bobigo AI"}\n\n`;
            if (msg.reasoning) {
                markdownContent += `> **Tiến trình suy luận:**\n> ${msg.reasoning.replace(/\n/g, "\n> ")}\n\n`;
            }
            markdownContent += `${msg.content}\n\n---\n\n`;
        });

        downloadFile(markdownContent, `${session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`, "text/markdown");
    });

    exportJsonBtn.addEventListener("click", () => {
        const session = getActiveSession();
        const jsonStr = JSON.stringify(session, null, 2);
        downloadFile(jsonStr, `${session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`, "application/json");
    });

    // --------------------------------------------------------------------------
    // Config Panel Logic
    // --------------------------------------------------------------------------
    function saveConfig() {
        persistConfig(config);
    }

    function initConfigUI() {
        systemPromptInput.value = config.systemPrompt;
        
        tempSlider.value = config.temperature;
        tempVal.textContent = parseFloat(config.temperature).toFixed(2);

        topPSlider.value = config.topP;
        topPVal.textContent = parseFloat(config.topP).toFixed(2);

        penaltySlider.value = config.repeatPenalty;
        penaltyVal.textContent = parseFloat(config.repeatPenalty).toFixed(2);

        maxTokensInput.value = config.maxTokens;
        toggleMemory.checked = config.memory;
        toggleReasoning.checked = config.showReasoning;
        if (toggleWebsearch) toggleWebsearch.checked = config.webSearch;
        if (toggleAgent) toggleAgent.checked = config.agentTools !== false;
        syncLangButtons();
    }

    // Live Config Inputs
    tempSlider.addEventListener("input", (e) => {
        tempVal.textContent = parseFloat(e.target.value).toFixed(2);
        config.temperature = parseFloat(e.target.value);
        saveConfig();
    });

    topPSlider.addEventListener("input", (e) => {
        topPVal.textContent = parseFloat(e.target.value).toFixed(2);
        config.topP = parseFloat(e.target.value);
        saveConfig();
    });

    penaltySlider.addEventListener("input", (e) => {
        penaltyVal.textContent = parseFloat(e.target.value).toFixed(2);
        config.repeatPenalty = parseFloat(e.target.value);
        saveConfig();
    });

    systemPromptInput.addEventListener("input", (e) => {
        config.systemPrompt = e.target.value.trim();
        saveConfig();
    });

    maxTokensInput.addEventListener("input", (e) => {
        config.maxTokens = parseInt(e.target.value, 10);
        saveConfig();
    });

    toggleMemory.addEventListener("change", (e) => {
        config.memory = e.target.checked;
        saveConfig();
    });

    toggleReasoning.addEventListener("change", (e) => {
        config.showReasoning = e.target.checked;
        saveConfig();
        renderCurrentSession();
    });

    if (toggleWebsearch) {
        toggleWebsearch.addEventListener("change", (e) => {
            config.webSearch = e.target.checked;
            saveConfig();
            syncWebSearchUI();
        });
    }

    if (toggleAgent) {
        toggleAgent.addEventListener("change", (e) => {
            config.agentTools = e.target.checked;
            saveConfig();
        });
    }

    resetConfigBtn.addEventListener("click", () => {
        localStorage.removeItem("bobigo_config");
        config = loadConfig();
        initConfigUI();
        syncWebSearchUI();
        applyLanguage(config.language);
    });

    function syncLangButtons() {
        const lang = config.language === "en" ? "en" : "vi";
        document.querySelectorAll("#lang-switch .lang-btn, #lang-switch-config .lang-btn").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
        });
    }

    function applyLanguage(lang) {
        config.language = lang === "en" ? "en" : "vi";
        const i18n = window.BobigoI18n;
        if (i18n) {
            i18n.apply(config.language);
            const pack = i18n.SYSTEM[config.language];
            if (pack && /Bạn là Bobigo|You are Bobigo/.test(config.systemPrompt || "")) {
                config.systemPrompt = pack;
                if (systemPromptInput) systemPromptInput.value = pack;
            }
        }
        saveConfig();
        syncLangButtons();
        const sub = document.getElementById("welcome-sub");
        const h1 = document.getElementById("welcome-h1");
        if (appMode !== "companion" && i18n && sub) {
            sub.textContent = i18n.t(config.language, "welcomeSub");
        }
        if (appMode !== "companion" && i18n && h1) {
            h1.innerHTML = `${i18n.t(config.language, "welcomeTitle")}<span class="gradient-text">Bobigo</span>`;
        }
        if (userInput && !isGenerating && llmReady) {
            userInput.placeholder = i18n ? i18n.t(config.language, "inputPh") : userInput.placeholder;
        }
        const meta = document.getElementById("input-meta");
        if (meta && i18n) {
            meta.innerHTML = `<span>${i18n.t(config.language, "inputMeta")}</span><span>${i18n.t(config.language, "disclaimer")}</span>`;
        }
        const title = document.getElementById("sidebar-title");
        if (title && i18n) {
            title.textContent = i18n.t(config.language, appMode === "companion" ? "companions" : "conversations");
        }
        if (appMode === "companion") {
            renderSidebar();
        } else {
            renderHistoryList();
        }
    }

    document.querySelectorAll("#lang-switch .lang-btn, #lang-switch-config .lang-btn").forEach((btn) => {
        btn.addEventListener("click", () => applyLanguage(btn.getAttribute("data-lang")));
    });

    // --------------------------------------------------------------------------
    // Companions: editor modal + knowledge
    // --------------------------------------------------------------------------
    const companionModal = document.getElementById("companion-modal");
    const companionBody = document.getElementById("companion-modal-body");
    document.getElementById("companion-modal-close")?.addEventListener("click", closeCompanionEditor);
    companionModal?.addEventListener("click", (e) => { if (e.target === companionModal) closeCompanionEditor(); });
    document.getElementById("companion-save-btn")?.addEventListener("click", saveCompanionEditor);
    document.getElementById("companion-delete-btn")?.addEventListener("click", deleteCompanionEditor);

    function closeCompanionEditor() { companionModal?.classList.add("hidden"); }
    function cval(id) { return (document.getElementById(id)?.value || "").trim(); }

    function openCompanionEditor(id) {
        if (!window.BobigoCompanions || !companionModal || !companionBody) return;
        const i18n = window.BobigoI18n; const lang = config.language || "vi";
        const t = (k, f) => (i18n ? i18n.t(lang, k) : f);
        let c = companions.find((x) => x.id === id);
        const isNew = !c;
        if (!c) c = BobigoCompanions.newCompanion({ language: lang });
        let knowledge = (c.knowledge || []).slice();
        let avatar = c.avatar || null;

        const emojis = BobigoCompanions.EMOJIS.map((e) =>
            `<button type="button" class="emoji-opt ${e === c.emoji ? "active" : ""}" data-emoji="${e}">${e}</button>`).join("");
        document.getElementById("companion-modal-title").textContent = isNew ? t("newCompanion", "Companion mới") : t("editCompanion", "Sửa companion");
        companionBody.innerHTML = `
            <div class="form-row">
                <div class="config-group" style="flex:0 0 auto">
                    <label>${t("companionAvatar", "Ảnh / biểu tượng")}</label>
                    <div class="avatar-edit">
                        <div class="avatar-preview" id="c-avatar-preview">${companionAvatarHTML({ avatar, emoji: c.emoji })}</div>
                        <button type="button" class="btn-icon-sm" id="c-avatar-btn" title="${t("uploadImage", "Tải ảnh")}"><i class="fa-solid fa-image"></i></button>
                        <button type="button" class="btn-icon-sm" id="c-avatar-clear" title="${t("useEmoji", "Dùng emoji")}"><i class="fa-solid fa-rotate-left"></i></button>
                        <input type="file" id="c-avatar-file" accept="image/*" style="display:none">
                    </div>
                </div>
                <div class="config-group" style="flex:1"><label>${t("companionName", "Tên")}</label><input id="c-name" value="${escapeHtml(c.name || "")}"></div>
            </div>
            <div class="config-group"><label>${t("companionEmoji", "Emoji (khi không có ảnh)")}</label><div class="emoji-grid" id="c-emoji">${emojis}</div></div>
            <div class="config-group"><label>${t("companionTagline", "Mô tả ngắn")}</label><input id="c-tagline" value="${escapeHtml(c.tagline || "")}"></div>
            <div class="config-group"><label>${t("companionPersona", "Tính cách")}</label><textarea id="c-persona" rows="3">${escapeHtml(c.persona || "")}</textarea></div>
            <div class="config-group"><label>${t("companionInstructions", "Hướng dẫn / vai trò")}</label><textarea id="c-instructions" rows="3">${escapeHtml(c.instructions || "")}</textarea></div>
            <div class="config-group">
                <label>${t("companionKnowledge", "Kiến thức")}</label>
                <div class="kn-list" id="c-knowledge"></div>
                <div class="kn-add">
                    <input id="c-kn-note" placeholder="${t("knowledgeNotePh", "Dán ghi chú / dữ kiện…")}">
                    <button type="button" class="btn-icon-sm" id="c-kn-add-btn" title="${t("addNote", "Thêm ghi chú")}"><i class="fa-solid fa-plus"></i></button>
                    <button type="button" class="btn-icon-sm" id="c-kn-file-btn" title="${t("uploadFile", "Tải tệp")}"><i class="fa-solid fa-paperclip"></i></button>
                    <input type="file" id="c-kn-file" accept=".pdf,.txt,.md,.json,.csv,.py,.js,.html,.css" style="display:none">
                </div>
            </div>`;

        companionBody.querySelectorAll(".emoji-opt").forEach((b) => b.addEventListener("click", () => {
            companionBody.querySelectorAll(".emoji-opt").forEach((x) => x.classList.remove("active"));
            b.classList.add("active");
        }));

        function refreshAvatarPreview() {
            const pv = document.getElementById("c-avatar-preview");
            const em = companionBody.querySelector(".emoji-opt.active");
            if (pv) pv.innerHTML = companionAvatarHTML({ avatar, emoji: em ? em.getAttribute("data-emoji") : c.emoji });
        }
        document.getElementById("c-avatar-btn").addEventListener("click", () => document.getElementById("c-avatar-file").click());
        document.getElementById("c-avatar-clear").addEventListener("click", () => { avatar = null; refreshAvatarPreview(); });
        document.getElementById("c-avatar-file").addEventListener("change", async (e) => {
            const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
            try { avatar = await resizeImageToDataURL(f); refreshAvatarPreview(); }
            catch (err) { alert(t("knowledgeFail", "Lỗi đọc tệp: ") + (err.message || err)); }
        });

        function renderKn() {
            const el = document.getElementById("c-knowledge");
            el.innerHTML = knowledge.length
                ? knowledge.map((k) => `<div class="kn-item" data-kn="${k.id}"><span class="kn-name">${escapeHtml(k.name || "note")}</span><span class="kn-size">${(k.text || "").length} ch</span><button type="button" class="kn-del"><i class="fa-solid fa-xmark"></i></button></div>`).join("")
                : `<div class="kn-empty">${t("noKnowledge", "Chưa có. Thêm ghi chú hoặc tải tệp.")}</div>`;
            el.querySelectorAll(".kn-item").forEach((row) => row.querySelector(".kn-del").addEventListener("click", () => {
                knowledge = knowledge.filter((k) => k.id !== row.getAttribute("data-kn")); renderKn();
            }));
        }
        renderKn();

        document.getElementById("c-kn-add-btn").addEventListener("click", () => {
            const txt = cval("c-kn-note"); if (!txt) return;
            knowledge.push({ id: BobigoCompanions.uid("kn"), name: txt.slice(0, 24) + (txt.length > 24 ? "…" : ""), text: txt, source: "note" });
            document.getElementById("c-kn-note").value = ""; renderKn();
        });
        document.getElementById("c-kn-file-btn").addEventListener("click", () => document.getElementById("c-kn-file").click());
        document.getElementById("c-kn-file").addEventListener("change", async (e) => {
            const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
            try {
                const fd = new FormData(); fd.append("file", f);
                const resp = await fetch("/api/extract-file", { method: "POST", body: fd });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || "extract failed");
                knowledge.push({ id: BobigoCompanions.uid("kn"), name: f.name, text: data.text || "", source: "file" });
                renderKn();
            } catch (err) { alert(t("knowledgeFail", "Lỗi đọc tệp: ") + (err.message || err)); }
        });

        companionModal._draft = { c, isNew, getKnowledge: () => knowledge, getAvatar: () => avatar };
        companionModal.classList.remove("hidden");
        const delBtn = document.getElementById("companion-delete-btn");
        if (delBtn) delBtn.style.display = isNew ? "none" : "";
    }

    function saveCompanionEditor() {
        if (!companionModal || !companionModal._draft) return;
        const { c, isNew, getKnowledge, getAvatar } = companionModal._draft;
        c.name = cval("c-name") || (config.language === "en" ? "Companion" : "Bạn đồng hành");
        const activeEmoji = companionBody.querySelector(".emoji-opt.active");
        if (activeEmoji) c.emoji = activeEmoji.getAttribute("data-emoji");
        c.avatar = getAvatar();
        c.tagline = cval("c-tagline");
        c.persona = cval("c-persona");
        c.instructions = cval("c-instructions");
        c.knowledge = getKnowledge();
        c.language = config.language;
        if (isNew) { companions.unshift(c); currentCompanionId = c.id; }
        saveSessions();
        closeCompanionEditor();
        if (appMode !== "companion") { setMode("companion"); setNavActive(railCompanionsBtn); }
        renderSidebar();
        renderCurrentSession();
        setModeLabel();
    }

    function deleteCompanionEditor() {
        if (!companionModal || !companionModal._draft) return;
        const { c } = companionModal._draft;
        companions = companions.filter((x) => x.id !== c.id);
        if (currentCompanionId === c.id) currentCompanionId = companions.length ? companions[0].id : null;
        saveSessions();
        closeCompanionEditor();
        renderSidebar();
        renderCurrentSession();
        setModeLabel();
    }
});

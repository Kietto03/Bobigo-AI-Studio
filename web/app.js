/**
 * Bobigo AI Studio — Full-Featured Frontend Logic
 * Web Search + Streaming Chat + Memory + Config Panel
 */

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
    const railRpBtn = document.getElementById("rail-rp-btn");
    const railHistoryBtn = document.getElementById("rail-history-btn");
    const railConfigBtn = document.getElementById("rail-config-btn");
    const openSettingsBtn = document.getElementById("open-settings-btn");
    
    const historyPanel = document.getElementById("history-panel");
    const configPanel = document.getElementById("config-panel");
    const closeConfigBtn = document.getElementById("close-config-btn");
    const topbarConfigBtn = document.getElementById("topbar-config-btn");
    const mobileToggle = document.getElementById("mobile-toggle");
    const sidebarOverlay = document.getElementById("sidebar-overlay");

    // History Panel Elements
    const newChatBtn = document.getElementById("new-chat-btn");
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
    const API_URL = "/v1/chat/completions";
    const HEALTH_URL = "/api/health";
    const SEARCH_URL = "/api/websearch";
    const MAX_ATTACH_BYTES = 80 * 1024;

    let sessions = loadSessions();
    let currentSessionId = null;
    let config = loadConfig();
    let abortController = null;
    let isGenerating = false;
    let activeGenerations = new Map(); // sessionId -> { abortController, assistantMsgObj }
    let llmReady = false;
    let appMode = "chat";
    let worlds = (window.BobigoRP && BobigoRP.loadWorlds()) || [];
    let currentWorldId = null;
    let rpTab = "worlds";
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
    initConfigUI();
    initSessions();
    initWorlds();
    syncWebSearchUI();
    applyLanguage(config.language || "vi");
    checkHealth();
    setInterval(checkHealth, 10000);

    // --------------------------------------------------------------------------
    // Theme Switcher (Dark / Light)
    // --------------------------------------------------------------------------
    function initTheme() {
        const savedTheme = localStorage.getItem("bobigo_theme") || "dark";
        setTheme(savedTheme);
    }

    function setTheme(theme) {
        if (theme === "light") {
            body.classList.remove("dark");
            body.classList.add("light");
            if (highlightStyle) {
                highlightStyle.href = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css";
            }
        } else {
            body.classList.remove("light");
            body.classList.add("dark");
            if (highlightStyle) {
                highlightStyle.href = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css";
            }
        }
        localStorage.setItem("bobigo_theme", theme);
    }

    themeToggle.addEventListener("click", () => {
        const current = body.classList.contains("light") ? "light" : "dark";
        setTheme(current === "light" ? "dark" : "light");
    });

    // --------------------------------------------------------------------------
    // Navigation Rail & Drawer Controllers (Responsive)
    // --------------------------------------------------------------------------
    function isMobile() {
        return window.innerWidth <= 768;
    }

    function syncSidebarOverlay() {
        if (!sidebarOverlay) return;
        const isAnyOpen = (!historyPanel.classList.contains("closed") || !configPanel.classList.contains("closed") || document.body.classList.contains("sidebar-open") || document.body.classList.contains("config-open"));
        if (isMobile() && isAnyOpen) {
            sidebarOverlay.classList.remove("hidden");
            sidebarOverlay.classList.add("active");
        } else {
            sidebarOverlay.classList.remove("active");
            sidebarOverlay.classList.add("hidden");
        }
    }

    function openHistoryDrawer() {
        historyPanel.classList.remove("closed");
        configPanel.classList.add("closed");
        document.body.classList.add("sidebar-open");
        document.body.classList.remove("config-open");
        syncSidebarOverlay();
    }

    function closeHistoryDrawer() {
        historyPanel.classList.add("closed");
        document.body.classList.remove("sidebar-open");
        syncSidebarOverlay();
    }

    function toggleHistoryDrawer() {
        if (historyPanel.classList.contains("closed") || !document.body.classList.contains("sidebar-open")) {
            openHistoryDrawer();
        } else {
            closeHistoryDrawer();
        }
    }

    function openConfigDrawer() {
        configPanel.classList.remove("closed");
        if (isMobile()) {
            historyPanel.classList.add("closed");
            document.body.classList.remove("sidebar-open");
        }
        document.body.classList.add("config-open");
        syncSidebarOverlay();
    }

    function closeConfigDrawer() {
        configPanel.classList.add("closed");
        document.body.classList.remove("config-open");
        syncSidebarOverlay();
    }

    function toggleConfigDrawer() {
        if (configPanel.classList.contains("closed")) {
            openConfigDrawer();
        } else {
            closeConfigDrawer();
        }
    }

    function closeAllDrawers() {
        historyPanel.classList.add("closed");
        configPanel.classList.add("closed");
        document.body.classList.remove("sidebar-open", "config-open");
        if (sidebarOverlay) {
            sidebarOverlay.classList.remove("active");
            sidebarOverlay.classList.add("hidden");
        }
    }

    // Auto-close drawers on mobile on page load
    if (isMobile()) {
        closeAllDrawers();
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", () => {
            closeAllDrawers();
        });
    }

    railChatBtn.addEventListener("click", () => {
        setMode("chat");
        setNavActive(railChatBtn);
        openHistoryDrawer();
    });

    if (railRpBtn) {
        railRpBtn.addEventListener("click", () => {
            setMode("roleplay");
            setNavActive(railRpBtn);
            openHistoryDrawer();
        });
    }

    railHistoryBtn.addEventListener("click", () => {
        setNavActive(railHistoryBtn);
        toggleHistoryDrawer();
    });

    railConfigBtn.addEventListener("click", () => {
        setNavActive(railConfigBtn);
        toggleConfigDrawer();
    });

    openSettingsBtn.addEventListener("click", () => {
        setNavActive(railConfigBtn);
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
            toggleHistoryDrawer();
        });
    }

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
    webSearchToggle.addEventListener("click", () => {
        config.webSearch = !config.webSearch;
        saveConfig();
        syncWebSearchUI();
    });

    function syncWebSearchUI() {
        if (config.webSearch) {
            webSearchToggle.classList.add("active");
            searchIndicator.textContent = "ON";
        } else {
            webSearchToggle.classList.remove("active");
            searchIndicator.textContent = "OFF";
        }
        if (toggleWebsearch) {
            toggleWebsearch.checked = config.webSearch;
        }
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
        if (healthCardLine) {
            const model = (data && data.model) || "—";
            const jinja = data && data.jinja_known ? (data.jinja ? "jinja ✓" : "jinja ✗") : "jinja ?";
            healthCardLine.textContent = `${data && data.llm_ready ? "Online" : "Offline"} · ${model} · ${jinja}`;
        }
        if (!isGenerating) {
            sendBtn.disabled = userInput.value.trim() === "" || !llmReady;
        }
        userInput.placeholder = llmReady 
            ? (i18n ? i18n.t(lang, "inputPh") : "Nhắn cho Bobigo…") 
            : (lang === "en" ? "Waiting for model to be ready…" : "Đợi mô hình sẵn sàng…");
    }

    async function checkHealth() {
        const lang = config.language || "vi";
        try {
            const res = await fetch(HEALTH_URL, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data.llm_ready === "boolean") {
                    applyHealth(data);
                    return;
                }
            }
        } catch (e) {
            /* fall through to /v1/models */
        }

        try {
            const res = await fetch("/v1/models", { cache: "no-store" });
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
            message: lang === "en" ? "Model not ready. Please wait for llama-server or run ./run.sh." : "Mô hình chưa sẵn sàng. Đợi llama-server hoặc chạy lại ./run.sh (dùng .venv).",
        });
    }

    // --------------------------------------------------------------------------
    // Web Search Function
    // --------------------------------------------------------------------------
    function refineSearchQuery(text) {
        let q = String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
        const sentence = q.split(/(?<=[.!?。？！])\s+/)[0] || q;
        q = sentence.length > 160 ? sentence.slice(0, 160) : sentence;
        return q;
    }

    async function performWebSearch(query, signal) {
        try {
            const res = await fetch(SEARCH_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query, max_results: 5 }),
                signal
            });

            if (!res.ok) throw new Error(`Search HTTP ${res.status}`);

            const data = await res.json();
            return data.results || [];
        } catch (e) {
            if (e && e.name === "AbortError") throw e;
            console.error("Web search error:", e);
            return [];
        }
    }

    function renderMarkdown(text) {
        if (typeof marked === "undefined") {
            return escapeHtml(text);
        }
        const html = marked.parse(text);
        if (typeof DOMPurify !== "undefined") {
            return DOMPurify.sanitize(html);
        }
        return html;
    }

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
        if (appMode === "roleplay") {
            if (window.BobigoRP) BobigoRP.saveWorlds(worlds);
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
        const newSession = {
            id: "session_" + Date.now(),
            title: "Cuộc trò chuyện mới",
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
        if (appMode === "roleplay") {
            return worlds.find((w) => w.id === currentWorldId) || worlds[0];
        }
        return sessions.find(s => s.id === currentSessionId) || sessions[0];
    }

    function initWorlds() {
        if (!window.BobigoRP) return;
        if (worlds.length === 0) {
            worlds = [BobigoRP.newWorld()];
            BobigoRP.saveWorlds(worlds);
        }
        currentWorldId = worlds[0].id;
    }

    function setMode(mode) {
        appMode = mode;
        document.body.classList.toggle("mode-rp", mode === "roleplay");
        const tabs = document.getElementById("rp-tabs");
        const sceneBar = document.getElementById("rp-scene-bar");
        const searchWrap = document.getElementById("history-search-wrap");
        const title = document.getElementById("sidebar-title");
        const nameLabel = document.getElementById("model-name-label");
        if (tabs) tabs.classList.toggle("hidden", mode !== "roleplay");
        if (sceneBar) sceneBar.classList.toggle("hidden", mode !== "roleplay");
        if (searchWrap) searchWrap.classList.toggle("hidden", mode === "roleplay" && rpTab !== "worlds");
        if (title) {
            const i18n = window.BobigoI18n;
            title.textContent = i18n
                ? i18n.t(config.language, mode === "roleplay" ? "roleplay" : "conversations")
                : (mode === "roleplay" ? "Roleplay" : "Cuộc trò chuyện");
        }
        if (nameLabel) nameLabel.textContent = mode === "roleplay" ? "Roleplay" : "Bobigo 35B";
        applyWelcomeCopy();
        renderSidebar();
        renderCurrentSession();
        syncRpSceneBar();
        syncPersonaFields();
        if (appMode !== "roleplay") {
            const i18n = window.BobigoI18n;
            const sub = document.getElementById("welcome-sub");
            const h1 = document.getElementById("welcome-h1");
            if (i18n && sub) sub.textContent = i18n.t(config.language, "welcomeSub");
            if (i18n && h1) h1.innerHTML = `${i18n.t(config.language, "welcomeTitle")}<span class="gradient-text">Bobigo</span>`;
        }
    }

    function applyWelcomeCopy() {
        if (!welcomeScreen || !welcomeDefaultHTML) return;
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        if (appMode !== "roleplay") {
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
        welcomeScreen.querySelector("h1").innerHTML = i18n ? i18n.t(lang, "rpWelcomeH1") : 'Vào <span class="gradient-text">cảnh</span>';
        const p = welcomeScreen.querySelector("p");
        if (p) p.textContent = i18n ? i18n.t(lang, "rpWelcomeSub") : "Tạo nhân vật, ghim ký ức — AI nhớ chi tiết trong kịch bản này.";
        const grid = welcomeScreen.querySelector(".suggestions-grid");
        if (grid) {
            grid.innerHTML = `
                <button class="suggestion-card" data-prompt="${escapeHtml(i18n ? i18n.t(lang, "rpCard1Prompt") : "")}">
                    <div class="card-header-icon"><i class="fa-solid fa-dungeon"></i></div>
                    <div class="card-title">${escapeHtml(i18n ? i18n.t(lang, "rpCard1Title") : "Quán rượu cảng")}</div>
                    <div class="card-desc">${escapeHtml(i18n ? i18n.t(lang, "rpCard1Desc") : "Fantasy — gặp bạn đồng hành")}</div>
                </button>
                <button class="suggestion-card" data-prompt="${escapeHtml(i18n ? i18n.t(lang, "rpCard2Prompt") : "")}">
                    <div class="card-header-icon"><i class="fa-solid fa-user-secret"></i></div>
                    <div class="card-title">${escapeHtml(i18n ? i18n.t(lang, "rpCard2Title") : "Noir")}</div>
                    <div class="card-desc">${escapeHtml(i18n ? i18n.t(lang, "rpCard2Desc") : "Đêm mưa, một vụ mất tích")}</div>
                </button>
                <button class="suggestion-card" data-prompt="${escapeHtml(i18n ? i18n.t(lang, "rpCard3Prompt") : "")}">
                    <div class="card-header-icon"><i class="fa-solid fa-mug-hot"></i></div>
                    <div class="card-title">${escapeHtml(i18n ? i18n.t(lang, "rpCard3Title") : "Đời thường")}</div>
                    <div class="card-desc">${escapeHtml(i18n ? i18n.t(lang, "rpCard3Desc") : "Hội thoại chậm, quan hệ")}</div>
                </button>
                <button class="suggestion-card" data-rp-action="generate">
                    <div class="card-header-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                    <div class="card-title">${escapeHtml((i18n && i18n.t(lang, "generate")) || "Tạo từ mô tả")}</div>
                    <div class="card-desc">${escapeHtml((i18n && i18n.t(lang, "generateHint")) || "")}</div>
                </button>
                <button class="suggestion-card" data-rp-action="new-char">
                    <div class="card-header-icon"><i class="fa-solid fa-user-plus"></i></div>
                    <div class="card-title">${escapeHtml((i18n && i18n.t(lang, "rpCard4Title")) || "Tạo nhân vật")}</div>
                    <div class="card-desc">${escapeHtml((i18n && i18n.t(lang, "rpCard4Desc")) || "Mở form cấu hình chi tiết")}</div>
                </button>`;
            grid.querySelectorAll(".suggestion-card").forEach((card) => {
                card.addEventListener("click", () => {
                    if (card.getAttribute("data-rp-action") === "generate") {
                        openGenerateModal();
                        return;
                    }
                    if (card.getAttribute("data-rp-action") === "new-char") {
                        openCharacterEditor(null);
                        return;
                    }
                    const prompt = card.getAttribute("data-prompt");
                    if (prompt) {
                        userInput.value = prompt;
                        handleSendMessage();
                    }
                });
            });
        }
    }

    function renderSidebar() {
        const castPane = document.getElementById("rp-cast-pane");
        const memPane = document.getElementById("rp-memory-pane");
        const list = historyList;
        const searchWrap = document.getElementById("history-search-wrap");
        const footer = document.getElementById("sidebar-footer");
        if (appMode !== "roleplay") {
            if (castPane) castPane.classList.add("hidden");
            if (memPane) memPane.classList.add("hidden");
            if (list) list.classList.remove("hidden");
            if (searchWrap) searchWrap.classList.remove("hidden");
            if (footer) footer.classList.remove("hidden");
            renderHistoryList();
            return;
        }
        if (footer) footer.classList.add("hidden");
        if (rpTab === "cast") {
            if (list) list.classList.add("hidden");
            if (searchWrap) searchWrap.classList.add("hidden");
            if (castPane) castPane.classList.remove("hidden");
            if (memPane) memPane.classList.add("hidden");
            renderCastList();
        } else if (rpTab === "memory") {
            if (list) list.classList.add("hidden");
            if (searchWrap) searchWrap.classList.add("hidden");
            if (castPane) castPane.classList.add("hidden");
            if (memPane) memPane.classList.remove("hidden");
            renderMemoryList();
        } else {
            if (list) list.classList.remove("hidden");
            if (searchWrap) searchWrap.classList.remove("hidden");
            if (castPane) castPane.classList.add("hidden");
            if (memPane) memPane.classList.add("hidden");
            renderWorldList();
        }
    }

    function renderWorldList(filterQuery) {
        historyList.innerHTML = "";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const q = (filterQuery || "").toLowerCase();
        const filtered = q ? worlds.filter((w) => (w.title || "").toLowerCase().includes(q)) : worlds;
        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = i18n ? i18n.t(lang, "noWorlds") : "Chưa có kịch bản.";
            historyList.appendChild(empty);
            return;
        }
        filtered.forEach((world) => {
            const item = document.createElement("div");
            item.className = `history-item ${world.id === currentWorldId ? "active" : ""}`;
            const charLabel = i18n ? i18n.t(lang, "charCount") : "nhân vật";
            const memLabel = i18n ? i18n.t(lang, "memCount") : "ký ức";
            const delTitle = i18n ? i18n.t(lang, "deleteScenario") : "Xóa kịch bản";
            item.innerHTML = `
                <div class="history-title-wrap">
                    <i class="fa-solid fa-masks-theater"></i>
                    <div>
                        <span class="history-item-title">${escapeHtml(world.title)}</span>
                        <span class="history-item-time">${(world.characters || []).length} ${charLabel} · ${(world.memory || []).length} ${memLabel}</span>
                    </div>
                </div>
                <i class="fa-solid fa-xmark history-delete-btn" title="${delTitle}"></i>`;
            item.addEventListener("click", (e) => {
                if (e.target.classList.contains("history-delete-btn")) return;
                currentWorldId = world.id;
                renderSidebar();
                renderCurrentSession();
                syncRpSceneBar();
                syncPersonaFields();
                if (isMobile()) closeAllDrawers();
            });
            item.querySelector(".history-delete-btn").addEventListener("click", (e) => {
                e.stopPropagation();
                worlds = worlds.filter((w) => w.id !== world.id);
                if (worlds.length === 0) worlds = [BobigoRP.newWorld({ language: config.language || "vi" })];
                if (currentWorldId === world.id) currentWorldId = worlds[0].id;
                saveSessions();
                renderSidebar();
                renderCurrentSession();
            });
            historyList.appendChild(item);
        });
    }

    function renderCastList() {
        const list = document.getElementById("cast-list");
        if (!list) return;
        const world = getActiveSession();
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        list.innerHTML = "";
        (world.characters || []).forEach((ch) => {
            const card = document.createElement("div");
            card.className = "cast-card" + (ch.enabled === false ? " off" : "");
            card.innerHTML = `
                <div class="cast-swatch" style="background:${escapeHtml(ch.color || "#ef233c")}"></div>
                <div class="cast-meta">
                    <div class="cast-name">${escapeHtml(ch.name || (i18n ? i18n.t(lang, "unnamedChar") : "Chưa đặt tên"))}</div>
                    <div class="cast-role">${escapeHtml(ch.role || "npc")}</div>
                </div>`;
            card.addEventListener("click", () => openCharacterEditor(ch.id));
            list.appendChild(card);
        });
    }

    function renderMemoryList() {
        const list = document.getElementById("memory-list");
        if (!list) return;
        const world = getActiveSession();
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        list.innerHTML = "";
        const mem = world.memory || [];
        if (mem.length === 0) {
            list.innerHTML = `<div class="history-empty">${i18n ? i18n.t(lang, "noMemory") : "Chưa ghim ký ức. Model sẽ tự thêm khi có dòng <<nhớ: …>>."}</div>`;
            return;
        }
        mem.forEach((fact) => {
            const row = document.createElement("div");
            row.className = "memory-item";
            row.innerHTML = `<span>${escapeHtml(fact.text)}</span><button type="button" title="Xóa">&times;</button>`;
            row.querySelector("button").addEventListener("click", () => {
                world.memory = (world.memory || []).filter((m) => m.id !== fact.id);
                saveSessions();
                renderMemoryList();
            });
            list.appendChild(row);
        });
    }

    function syncRpSceneBar() {
        const el = document.getElementById("rp-scene-title");
        const world = getActiveSession();
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        if (el && appMode === "roleplay" && world) {
            el.textContent = world.title || (i18n ? i18n.t(lang, "newWorld") : "Kịch bản");
        }
    }

    function syncPersonaFields() {
        const world = getActiveSession();
        const name = document.getElementById("rp-user-name");
        const desc = document.getElementById("rp-user-desc");
        if (!world || !world.userPersona) return;
        if (name) name.value = world.userPersona.name || "";
        if (desc) desc.value = world.userPersona.description || "";
    }

    function renderHistoryList(filterQuery = "") {
        historyList.innerHTML = "";
        const i18n = window.BobigoI18n;
        const lang = config.language || "vi";
        const filtered = filterQuery
            ? sessions.filter(s => s.title.toLowerCase().includes(filterQuery.toLowerCase()))
            : sessions;

        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = filterQuery ? (i18n ? i18n.t(lang, "noMatchChats") : "Không có cuộc trò chuyện khớp.") : (i18n ? i18n.t(lang, "noHistory") : "Chưa có lịch sử.");
            historyList.appendChild(empty);
            return;
        }

        filtered.forEach(session => {
            const isGen = activeGenerations.has(session.id);
            const item = document.createElement("div");
            item.className = `history-item ${session.id === currentSessionId ? "active" : ""} ${isGen ? "is-generating" : ""}`;
            item.setAttribute("data-id", session.id);
            const delTitle = i18n ? i18n.t(lang, "deleteChat") : "Xóa đoạn chat";

            item.innerHTML = `
                <div class="history-title-wrap">
                    <i class="fa-regular fa-message"></i>
                    <div>
                        <span class="history-item-title">${escapeHtml(session.title)}</span>
                        <span class="history-item-time">${relativeTime(session.createdAt)}</span>
                    </div>
                </div>
                <i class="fa-solid fa-xmark history-delete-btn" title="${delTitle}"></i>
            `;

            item.addEventListener("click", (e) => {
                if (e.target.classList.contains("history-delete-btn")) return;
                currentSessionId = session.id;
                renderHistoryList(filterQuery);
                renderCurrentSession();
                if (isMobile()) closeAllDrawers();
            });

            const deleteBtn = item.querySelector(".history-delete-btn");
            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                deleteSession(session.id);
            });

            historyList.appendChild(item);
        });
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
        if (appMode === "roleplay") renderSidebar();
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

        if (currentSessionId !== sessionId) {
            currentSessionId = sessionId;
            renderCurrentSession();
        }

        handleSendMessage({
            text: newText.trim(),
            fullContent: fullPrompt,
            attachments: attachments,
            sessionId: sessionId,
        });
    }

    function handleRegenerateFromIndex(msgIndex) {
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
        session.messages = session.messages.slice(0, userIndex + 1);
        saveSessions();
        renderCurrentSession();
        handleSendMessage({
            regenerate: true,
            text: userMsg.text || userMsg.content,
            fullContent: userMsg.content,
            attachments: userMsg.attachments,
            sessionId: session.id,
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

        const isThisSessionGenerating = activeGenerations.has(session.id);
        setGenerating(isThisSessionGenerating);

        if (!session.messages || session.messages.length === 0) {
            messagesContainer.appendChild(welcomeScreen);
            welcomeScreen.style.display = "block";
        } else {
            welcomeScreen.style.display = "none";
            session.messages.forEach((msg, idx) => {
                const isMsgStreaming = (idx === session.messages.length - 1 && isThisSessionGenerating);
                const msgEl = createMessageElement(msg.role, msg.content, msg.reasoning, msg.searchResults, msg.toolEvents, msg.attachments, msg.text, idx, isMsgStreaming);
                messagesContainer.appendChild(msgEl);
            });
            scrollToBottom();
        }
    }

    // --------------------------------------------------------------------------
    // File & PDF Attachment Logic
    // --------------------------------------------------------------------------
    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

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
        let rawText = regen ? String(opts.text || "").trim() : userInput.value.trim();
        if (!rawText && (!attachedFiles || attachedFiles.length === 0) && !(opts && opts.fullContent)) return;

        const targetSession = (opts && opts.sessionId) ? (sessions.find(s => s.id === opts.sessionId) || getActiveSession()) : getActiveSession();
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
            if (appMode === "roleplay") renderSidebar();
            else renderHistoryList();
        }

        if (welcomeScreen && welcomeScreen.parentElement) {
            welcomeScreen.style.display = "none";
        }

        if (!regen && currentSessionId === targetSessionId) {
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

        // --- Web Search Phase (only when agent tools are off) ---
        let searchResults = [];
        let searchContextText = "";
        if (config.webSearch && config.agentTools === false && appMode !== "roleplay") {
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

        if (currentSessionId === targetSessionId) {
            appendMessageUI("assistant", "", "", searchResults, null, null, null, targetSession.messages.length - 1, true);
        }

        // Update sidebar generating badge
        if (appMode === "roleplay") renderSidebar();
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

        const isRp = appMode === "roleplay";
        const messagesPayload = isRp
            ? messageContext
            : [{ role: "system", content: config.systemPrompt }, ...messageContext];

        const payload = {
            model: "qwen35b-uncensored",
            messages: messagesPayload,
            temperature: config.temperature,
            top_p: config.topP,
            repeat_penalty: config.repeatPenalty,
            max_tokens: config.maxTokens > 0 ? config.maxTokens : undefined,
            stream: true,
            agent_tools: isRp ? false : config.agentTools !== false,
            mode: isRp ? "roleplay" : "chat",
        };
        if (isRp && window.BobigoRP) {
            payload.roleplay = BobigoRP.toPayload(targetSession);
        }

        let fullReasoning = "";
        let fullAssistantContent = "";
        let toolEvents = [];

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

                            if (currentSessionId === targetSessionId) {
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

                                const lastAssistantRow = messagesContainer.querySelector(".message-row.assistant:last-child");
                                if (lastAssistantRow) {
                                    const liveBubble = lastAssistantRow.querySelector(".bubble");
                                    if (liveBubble) {
                                        liveBubble.innerHTML = htmlOutput;
                                        enhanceMarkdownElements(liveBubble);
                                        scrollToBottom();
                                    }
                                }
                            }

                        } catch (err) {
                            console.error("JSON parse error", err);
                        }
                    }
                }
            }

            if (isRp && window.BobigoRP) {
                const harvested = BobigoRP.harvestMemory(fullAssistantContent);
                harvested.facts.forEach((fact) => BobigoRP.addMemory(targetSession, fact, "model"));
                fullAssistantContent = harvested.clean;
                BobigoRP.appendSceneLog(targetSession, cleanPrompt, fullAssistantContent);
                if (isRp) renderMemoryList();
            }

            assistantMsgObj.content = fullAssistantContent;
            assistantMsgObj.reasoning = fullReasoning;
            assistantMsgObj.toolEvents = toolEvents;

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
            delete assistantMsgObj.isStreaming;
            activeGenerations.delete(targetSessionId);
            saveSessions();

            if (currentSessionId === targetSessionId) {
                setGenerating(false);
                renderCurrentSession();
            }
            if (appMode === "roleplay") renderSidebar();
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
            regenBtn.addEventListener("click", () => handleRegenerateFromIndex(msgIndex));
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
            stack.appendChild(actions);
        }

        row.appendChild(avatar);
        row.appendChild(stack);
        return row;
    }

    function relativeTime(iso) {
        if (!iso) return "";
        const then = new Date(iso).getTime();
        if (Number.isNaN(then)) return "";
        const delta = Math.max(0, Date.now() - then);
        const min = Math.floor(delta / 60000);
        const i18n = window.BobigoI18n;
        const lang = (config && config.language) || "vi";
        if (min < 1) return i18n ? i18n.t(lang, "justNow") : "Vừa xong";
        if (min < 60) return `${min}${i18n ? i18n.t(lang, "minAgo") : " phút trước"}`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}${i18n ? i18n.t(lang, "hrAgo") : " giờ trước"}`;
        const day = Math.floor(hr / 24);
        if (day < 7) return `${day}${i18n ? i18n.t(lang, "dayAgo") : " ngày trước"}`;
        return new Date(iso).toLocaleDateString("vi-VN");
    }

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function escapeHtml(str) {
        return str.replace(/[&<>"']/g, function(m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
        });
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

    document.getElementById("export-story-btn")?.addEventListener("click", () => {
        const session = getActiveSession();
        const lang = config.language || "vi";
        const i18n = window.BobigoI18n;
        let md = `# ${session.title || "Story"}\n\n`;
        if (appMode === "roleplay" && session.setting) {
            const s = BobigoRP.normalizeSetting(session.setting);
            md += `## ${i18n ? i18n.t(lang, "scene") : "Setting"}\n`;
            Object.entries(s).forEach(([k, v]) => {
                if (v) md += `- **${k}**: ${v}\n`;
            });
            md += "\n";
            (session.characters || []).forEach((ch) => {
                md += `### ${ch.name} (${ch.role || "npc"})\n`;
                if (ch.personality) md += `${ch.personality}\n`;
                md += "\n";
            });
        }
        md += `---\n\n`;
        (session.messages || []).forEach((msg) => {
            const who = msg.role === "user"
                ? (i18n ? i18n.t(lang, "user") : "User")
                : (i18n ? i18n.t(lang, "assistant") : "Bobigo");
            md += `### ${who}\n\n${msg.content || ""}\n\n`;
        });
        const slug = String(session.title || "story").replace(/[^a-z0-9]/gi, "_").toLowerCase();
        downloadFile(md, `${slug}.md`, "text/markdown");
        const pack = {
            type: "bobigo-story",
            version: 1,
            world: session,
        };
        downloadFile(JSON.stringify(pack, null, 2), `${slug}.bobigo.json`, "application/json");
    });

    document.getElementById("import-story-btn")?.addEventListener("click", () => {
        document.getElementById("import-story-input")?.click();
    });
    document.getElementById("import-story-input")?.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(String(reader.result));
                let data = parsed;
                if (parsed && parsed.type === "bobigo-story" && parsed.world) data = parsed.world;
                if (!window.BobigoRP) return;
                const world = BobigoRP.worldFromDraft(data, data.language || config.language);
                world.messages = Array.isArray(data.messages) ? data.messages : [];
                world.memory = Array.isArray(data.memory) ? data.memory : [];
                world.sceneLog = Array.isArray(data.sceneLog) ? data.sceneLog : [];
                if (data.id) world.id = "world_" + Date.now();
                worlds.unshift(world);
                currentWorldId = world.id;
                appMode = "roleplay";
                BobigoRP.saveWorlds(worlds);
                setMode("roleplay");
                setNavActive(railRpBtn);
            } catch (err) {
                alert("Import failed: " + err.message);
            }
        };
        reader.readAsText(file);
    });

    function downloadFile(content, fileName, contentType) {
        const a = document.createElement("a");
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // --------------------------------------------------------------------------
    // Config Panel Logic
    // --------------------------------------------------------------------------
    function loadConfig() {
        const defaults = {
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

        try {
            const saved = JSON.parse(localStorage.getItem("bobigo_config"));
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

    function saveConfig() {
        localStorage.setItem("bobigo_config", JSON.stringify(config));
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
        if (appMode !== "roleplay" && i18n && sub) {
            sub.textContent = i18n.t(config.language, "welcomeSub");
        }
        if (appMode !== "roleplay" && i18n && h1) {
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
            title.textContent = i18n.t(config.language, appMode === "roleplay" ? "roleplay" : "conversations");
        }
        if (appMode === "roleplay") {
            const world = getActiveSession();
            if (world) world.language = config.language;
            saveSessions();
            renderSidebar();
        } else {
            renderHistoryList();
        }
    }

    document.querySelectorAll("#lang-switch .lang-btn, #lang-switch-config .lang-btn").forEach((btn) => {
        btn.addEventListener("click", () => applyLanguage(btn.getAttribute("data-lang")));
    });

    // --------------------------------------------------------------------------
    // Roleplay: tabs, persona, memory, character modal
    // --------------------------------------------------------------------------
    let rpEditCharId = null;
    let rpModalMode = "character";

    document.querySelectorAll(".sidebar-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            rpTab = tab.getAttribute("data-rp-tab") || "worlds";
            document.querySelectorAll(".sidebar-tab").forEach((t) => t.classList.toggle("active", t === tab));
            renderSidebar();
        });
    });

    const addCharacterBtn = document.getElementById("add-character-btn");
    if (addCharacterBtn) addCharacterBtn.addEventListener("click", () => openCharacterEditor(null));

    const rpUserName = document.getElementById("rp-user-name");
    const rpUserDesc = document.getElementById("rp-user-desc");
    if (rpUserName) {
        rpUserName.addEventListener("input", () => {
            const world = getActiveSession();
            if (!world.userPersona) world.userPersona = { name: "", description: "" };
            world.userPersona.name = rpUserName.value.trim();
            saveSessions();
        });
    }
    if (rpUserDesc) {
        rpUserDesc.addEventListener("input", () => {
            const world = getActiveSession();
            if (!world.userPersona) world.userPersona = { name: "", description: "" };
            world.userPersona.description = rpUserDesc.value.trim();
            saveSessions();
        });
    }

    const memoryAddBtn = document.getElementById("memory-add-btn");
    const memoryInput = document.getElementById("memory-input");
    if (memoryAddBtn && memoryInput) {
        const pin = () => {
            if (!window.BobigoRP) return;
            BobigoRP.addMemory(getActiveSession(), memoryInput.value, "user");
            memoryInput.value = "";
            saveSessions();
            renderMemoryList();
        };
        memoryAddBtn.addEventListener("click", pin);
        memoryInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                pin();
            }
        });
    }
    const memoryClearBtn = document.getElementById("memory-clear-btn");
    if (memoryClearBtn) {
        memoryClearBtn.addEventListener("click", () => {
            const i18n = window.BobigoI18n;
            const lang = config.language || "vi";
            const confirmMsg = (i18n && i18n.t(lang, "confirmClearMemory")) || "Xóa toàn bộ ký ức của kịch bản này?";
            if (!confirm(confirmMsg)) return;
            getActiveSession().memory = [];
            getActiveSession().sceneLog = [];
            saveSessions();
            renderMemoryList();
        });
    }

    const rpModal = document.getElementById("rp-modal");
    const rpModalBody = document.getElementById("rp-modal-body");
    const rpModalTitle = document.getElementById("rp-modal-title");
    document.getElementById("rp-modal-close")?.addEventListener("click", closeRpModal);
    document.getElementById("rp-edit-setting-btn")?.addEventListener("click", openSettingEditor);
    rpModal?.addEventListener("click", (e) => {
        if (e.target === rpModal) closeRpModal();
    });
    document.getElementById("rp-modal-save")?.addEventListener("click", saveRpModal);
    document.getElementById("rp-modal-delete")?.addEventListener("click", deleteRpModalTarget);

    function openCharacterEditor(charId) {
        if (!window.BobigoRP) return;
        rpModalMode = "character";
        const world = getActiveSession();
        const i18n = window.BobigoI18n;
        const lang = world.language || config.language || "vi";
        const isEn = lang === "en";
        let ch = (world.characters || []).find((c) => c.id === charId);
        if (!ch) {
            ch = BobigoRP.newCharacter(null, lang);
            world.characters = (world.characters || []).concat(ch);
            saveSessions();
        }
        rpEditCharId = ch.id;
        if (rpModalTitle) {
            rpModalTitle.textContent = ch.name 
                ? ((i18n && i18n.t(lang, "editChar")) || "Sửa nhân vật") 
                : ((i18n && i18n.t(lang, "newChar")) || "Nhân vật mới");
        }

        const roles = isEn
            ? ["companion", "npc", "rival", "narrator", "romantic interest", "mentor"]
            : ["bạn đồng hành", "npc", "đối thủ", "người dẫn chuyện", "tình địch", "mentor"];

        rpModalBody.innerHTML = `
            <div class="form-row">
                <div class="config-group"><label>${(i18n && i18n.t(lang, "charName")) || "Tên"}</label><input id="f-name" value="${escapeHtml(ch.name)}"></div>
                <div class="config-group"><label>${(i18n && i18n.t(lang, "charRole")) || "Vai trò"}</label>
                    <select id="f-role">
                        ${roles.map((r) =>
                            `<option ${ch.role === r ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="config-group"><label>${(i18n && i18n.t(lang, "charAge")) || "Tuổi"}</label><input id="f-age" value="${escapeHtml(ch.age)}"></div>
                <div class="config-group"><label>${(i18n && i18n.t(lang, "charGender")) || "Giới tính"}</label><input id="f-gender" value="${escapeHtml(ch.gender)}"></div>
            </div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charAppearance")) || "Ngoại hình"}</label><textarea id="f-appearance" rows="2">${escapeHtml(ch.appearance)}</textarea></div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charPersonality")) || "Tính cách"}</label><textarea id="f-personality" rows="2">${escapeHtml(ch.personality)}</textarea></div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charSpeech")) || "Cách nói chuyện"}</label><textarea id="f-speech" rows="2">${escapeHtml(ch.speech)}</textarea></div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charGoals")) || "Mục tiêu / động cơ"}</label><textarea id="f-goals" rows="2">${escapeHtml(ch.goals)}</textarea></div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charRelationships")) || "Quan hệ"}</label><textarea id="f-relationships" rows="2">${escapeHtml(ch.relationships)}</textarea></div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charExampleLines")) || "Ví dụ thoại"}</label><textarea id="f-example" rows="2">${escapeHtml(ch.exampleLines)}</textarea></div>
            <div class="config-group"><label>${(i18n && i18n.t(lang, "charNotes")) || "Ghi chú"}</label><textarea id="f-notes" rows="2">${escapeHtml(ch.notes)}</textarea></div>
            <label class="config-toggle-row" style="padding:0;">
                <span class="toggle-label">${(i18n && i18n.t(lang, "charPresent")) || "Có mặt trong cảnh"}</span>
                <input type="checkbox" id="f-enabled" ${ch.enabled !== false ? "checked" : ""}>
            </label>`;
        rpModal.classList.remove("hidden");
        document.getElementById("rp-modal-delete").style.display = "";
    }

    function openSettingEditor() {
        const world = getActiveSession();
        const s = (window.BobigoRP && BobigoRP.normalizeSetting(world.setting)) || {};
        const lang = world.language || config.language || "vi";
        const en = lang === "en";
        rpModalMode = "setting";
        rpEditCharId = null;
        if (rpModalTitle) rpModalTitle.textContent = en ? "Scenario setting" : "Bối cảnh kịch bản";
        const field = (id, label, hint, value, rows) => `
            <div class="config-group">
                <label>${label}</label>
                ${rows > 1
                    ? `<textarea id="${id}" rows="${rows}" placeholder="${hint}">${escapeHtml(value || "")}</textarea>`
                    : `<input id="${id}" value="${escapeHtml(value || "")}" placeholder="${hint}">`}
            </div>`;
        rpModalBody.innerHTML = `
            <div class="setting-section">
                <h4>${en ? "Basics" : "Cơ bản"}</h4>
                ${field("f-title", en ? "Title" : "Tiêu đề", "", world.title, 1)}
                <div class="config-group">
                    <label>${en ? "Play language" : "Ngôn ngữ chơi"}</label>
                    <div class="lang-switch lang-switch-wide" id="f-world-lang">
                        <button type="button" class="lang-btn ${lang === "vi" ? "active" : ""}" data-lang="vi">Tiếng Việt</button>
                        <button type="button" class="lang-btn ${lang === "en" ? "active" : ""}" data-lang="en">English</button>
                    </div>
                </div>
                ${field("f-genre", en ? "Genre" : "Thể loại", en ? "Fantasy, noir, slice of life…" : "Fantasy, noir, đời thường…", s.genre, 1)}
                ${field("f-era", en ? "Era / period" : "Thời đại", en ? "Late 1920s, far future…" : "Cuối 1920, tương lai xa…", s.era, 1)}
            </div>
            <div class="setting-section">
                <h4>${en ? "World" : "Thế giới"}</h4>
                ${field("f-world", en ? "World overview" : "Tổng quan thế giới", en ? "How this world works" : "Thế giới này vận hành ra sao", s.world, 3)}
                ${field("f-location", en ? "Current location" : "Địa điểm hiện tại", en ? "Harbor tavern, office…" : "Quán rượu cảng, văn phòng…", s.location, 2)}
                ${field("f-lore", en ? "History / lore" : "Lịch sử / lore", "", s.lore, 3)}
                ${field("f-factions", en ? "Factions / society" : "Phe phái / xã hội", "", s.factions, 2)}
            </div>
            <div class="setting-section">
                <h4>${en ? "This scene" : "Cảnh này"}</h4>
                ${field("f-atmosphere", en ? "Atmosphere / tone" : "Không khí / tông", en ? "Wet, tense, tender…" : "Ẩm, căng, dịu…", s.atmosphere, 2)}
                ${field("f-timeWeather", en ? "Time & weather" : "Thời gian & thời tiết", "", s.timeWeather, 1)}
                ${field("f-sensory", en ? "Sensory details" : "Chi tiết giác quan", en ? "Sights, sounds, smells" : "Nhìn, nghe, mùi", s.sensory, 2)}
                ${field("f-conflict", en ? "Conflict / stakes" : "Xung đột / stakes", "", s.conflict, 2)}
            </div>
            <div class="setting-section">
                <h4>${en ? "Rules" : "Luật"}</h4>
                ${field("f-power", en ? "Magic / tech rules" : "Luật phép / công nghệ", "", s.powerRules, 2)}
                ${field("f-taboos", en ? "Content limits" : "Giới hạn nội dung", "", s.taboos, 2)}
                ${field("f-rules", en ? "RP rules" : "Quy tắc RP", en ? "Stay in character. Honor OOC." : "Ở trong nhân vật. Tôn trọng OOC.", world.rules, 3)}
            </div>`;
        rpModal.classList.remove("hidden");
        document.getElementById("rp-modal-delete").style.display = "none";
        document.querySelectorAll("#f-world-lang .lang-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll("#f-world-lang .lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
            });
        });
    }

    function closeRpModal() {
        rpModal?.classList.add("hidden");
    }

    function val(id) {
        return (document.getElementById(id)?.value || "").trim();
    }

    function saveRpModal() {
        const world = getActiveSession();
        if (rpModalMode === "setting") {
            world.title = val("f-title") || (config.language === "en" ? "New scenario" : "Kịch bản mới");
            world.language = document.querySelector("#f-world-lang .lang-btn.active")?.getAttribute("data-lang") || world.language || "vi";
            world.rules = val("f-rules");
            world.setting = {
                genre: val("f-genre"),
                era: val("f-era"),
                world: val("f-world"),
                location: val("f-location"),
                atmosphere: val("f-atmosphere"),
                factions: val("f-factions"),
                lore: val("f-lore"),
                powerRules: val("f-power"),
                conflict: val("f-conflict"),
                timeWeather: val("f-timeWeather"),
                sensory: val("f-sensory"),
                taboos: val("f-taboos"),
            };
        } else {
            const ch = (world.characters || []).find((c) => c.id === rpEditCharId);
            if (ch) {
                ch.name = val("f-name");
                ch.role = val("f-role");
                ch.age = val("f-age");
                ch.gender = val("f-gender");
                ch.appearance = val("f-appearance");
                ch.personality = val("f-personality");
                ch.speech = val("f-speech");
                ch.goals = val("f-goals");
                ch.relationships = val("f-relationships");
                ch.exampleLines = val("f-example");
                ch.notes = val("f-notes");
                ch.enabled = !!document.getElementById("f-enabled")?.checked;
            }
        }
        saveSessions();
        closeRpModal();
        renderSidebar();
        syncRpSceneBar();
    }

    function deleteRpModalTarget() {
        if (rpModalMode !== "character" || !rpEditCharId) return;
        const world = getActiveSession();
        world.characters = (world.characters || []).filter((c) => c.id !== rpEditCharId);
        saveSessions();
        closeRpModal();
        renderCastList();
    }

    const genModal = document.getElementById("rp-generate-modal");
    const genPreview = document.getElementById("rp-generate-preview");
    const genRun = document.getElementById("rp-generate-run");
    const genApply = document.getElementById("rp-generate-apply");
    const genBrief = document.getElementById("rp-brief-input");
    let pendingDraft = null;

    function openGenerateModal() {
        pendingDraft = null;
        if (genBrief) genBrief.value = "";
        if (genPreview) {
            genPreview.textContent = "";
            genPreview.classList.add("hidden");
        }
        genApply?.classList.add("hidden");
        genRun?.classList.remove("hidden");
        genModal?.classList.remove("hidden");
        if (window.BobigoI18n) BobigoI18n.apply(config.language);
    }

    document.getElementById("rp-generate-btn")?.addEventListener("click", openGenerateModal);
    document.getElementById("rp-generate-close")?.addEventListener("click", () => genModal?.classList.add("hidden"));
    genModal?.addEventListener("click", (e) => {
        if (e.target === genModal) genModal.classList.add("hidden");
    });

    genRun?.addEventListener("click", async () => {
        const brief = (genBrief?.value || "").trim();
        if (!brief || !llmReady) return;
        const i18n = window.BobigoI18n;
        genRun.disabled = true;
        genRun.textContent = i18n ? i18n.t(config.language, "generateBusy") : "…";
        try {
            const res = await fetch("/api/roleplay/expand", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ brief, language: config.language }),
            });
            if (!res.ok) throw new Error(await res.text());
            pendingDraft = await res.json();
            if (genPreview) {
                genPreview.classList.remove("hidden");
                genPreview.textContent = JSON.stringify(pendingDraft, null, 2);
            }
            genApply?.classList.remove("hidden");
        } catch (err) {
            alert(err.message || String(err));
        } finally {
            genRun.disabled = false;
            if (i18n) genRun.textContent = i18n.t(config.language, "generateGo");
        }
    });

    genApply?.addEventListener("click", () => {
        if (!pendingDraft || !window.BobigoRP) return;
        const world = BobigoRP.worldFromDraft(pendingDraft, config.language);
        worlds.unshift(world);
        currentWorldId = world.id;
        BobigoRP.saveWorlds(worlds);
        genModal?.classList.add("hidden");
        setMode("roleplay");
        setNavActive(railRpBtn);
        rpTab = "cast";
        document.querySelectorAll(".sidebar-tab").forEach((t) => {
            t.classList.toggle("active", t.getAttribute("data-rp-tab") === "cast");
        });
        renderSidebar();
        openSettingEditor();
    });
});

/**
 * Backend health panel: polls /api/health (fallback /v1/models), paints the
 * status banner/dot/card/speed, and reports readiness back to the app.
 * Shared-state mutations (contextInfo, model name, send-button gating) are
 * delegated to the `onApplied` callback owned by main.js.
 */

export function createHealthController({ els = {}, getLanguage, onApplied }) {
    const { statusLabel, statusDot, statusBanner } = els;
    let llmReady = false;

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

    function applyHealth(data) {
        llmReady = !!(data && data.llm_ready);
        const jinjaBad = data && data.jinja_known && data.jinja === false;
        const i18n = window.BobigoI18n;
        const lang = getLanguage();

        if (!data || !data.llm_ready) {
            if (statusDot) statusDot.className = "status-dot loading";
            if (statusLabel) statusLabel.textContent = i18n ? i18n.t(lang, "loadingModel") : "Đang tải mô hình";
            if (statusBanner) {
                statusBanner.className = "status-banner";
                statusBanner.textContent = (data && data.message) || (lang === "en" ? "Waiting for llama-server to load model into GPU…" : "Đang chờ llama-server nạp model vào GPU…");
            }
        } else {
            if (statusDot) statusDot.className = "status-dot online";
            if (statusLabel) statusLabel.textContent = i18n ? i18n.t(lang, "ready") : "Sẵn sàng";
            if (statusBanner) {
                statusBanner.className = "status-banner hidden";
                statusBanner.textContent = "";
            }
        }
        if (data && Number.isFinite(data.context_window)) data._ctxWindow = data.context_window;
        const online = !!llmReady;
        const healthCard = document.getElementById("health-card");
        if (healthCard) {
            healthCard.classList.toggle("ready", online);
            healthCard.classList.toggle("loading", !online);
        }
        const hDot = document.getElementById("health-dot");
        const hStatus = document.getElementById("health-status");
        const hModel = document.getElementById("health-model");
        const hLatency = document.getElementById("health-latency");
        const hJinja = document.getElementById("health-jinja");
        const hCtx = document.getElementById("health-ctx");
        if (hDot) hDot.className = "health-dot " + (online ? (jinjaBad ? "warn" : "online") : "loading");
        if (hStatus) hStatus.textContent = online ? (i18n ? i18n.t(lang, "ready") : "Sẵn sàng") : (i18n ? i18n.t(lang, "loadingModel") : "Đang tải mô hình");
        if (hModel) { const m = (data && data.model) || "—"; hModel.textContent = m.length > 30 ? "…" + m.slice(-30) : m; hModel.title = m; }
        if (hLatency) hLatency.textContent = (data && Number.isFinite(data.latency)) ? `${data.latency} ms` : "—";
        if (hJinja) hJinja.textContent = data && data.jinja_known ? (data.jinja ? "✓" : "✗") : "?";
        if (hCtx) hCtx.textContent = (data && data.context_window) ? data.context_window.toLocaleString() : "—";
        syncModelSelect(data && data.model);
        updateHealthSpeedDisplay();
        // Let the app react (model name, context budget, send-button state…).
        if (onApplied) onApplied(data || {}, llmReady);
    }

    async function checkHealth() {
        const lang = getLanguage();
        const t0 = performance.now();
        try {
            const res = await fetch("/api/health", { cache: "no-store" });
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

    let availableModels = [];

    function syncModelSelect(currentModelName) {
        const select = document.getElementById("model-select");
        const sizeSpan = document.getElementById("model-select-size");
        if (!select || !currentModelName) return;
        for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i];
            if (opt.value === currentModelName || currentModelName.includes(opt.value)) {
                if (select.selectedIndex !== i) {
                    select.selectedIndex = i;
                }
                const found = availableModels.find(m => m.filename === opt.value);
                if (sizeSpan && found) {
                    sizeSpan.textContent = `${found.size_gb} GB`;
                }
                break;
            }
        }
    }

    async function loadModelsList() {
        const select = document.getElementById("model-select");
        const sizeSpan = document.getElementById("model-select-size");
        if (!select) return;

        try {
            const res = await fetch("/api/models");
            if (!res.ok) return;
            const data = await res.json();
            availableModels = data.models || [];
            if (!availableModels.length) return;

            select.innerHTML = "";
            availableModels.forEach((m) => {
                const opt = document.createElement("option");
                opt.value = m.filename;
                const isDef = m.is_default ? " (Mặc định)" : "";
                opt.textContent = `${m.filename} (${m.size_gb} GB)${isDef}`;
                if (m.is_default) {
                    opt.selected = true;
                    if (sizeSpan) sizeSpan.textContent = `${m.size_gb} GB`;
                }
                select.appendChild(opt);
            });
        } catch (e) {
            console.debug("Unable to fetch /api/models:", e);
        }
    }

    function initModelSwitcher() {
        const select = document.getElementById("model-select");
        const sizeSpan = document.getElementById("model-select-size");
        if (!select) return;

        select.addEventListener("change", async () => {
            const chosen = select.value;
            const item = availableModels.find(m => m.filename === chosen);
            if (sizeSpan && item) {
                sizeSpan.textContent = `${item.size_gb} GB`;
            }

            const lang = getLanguage();
            const promptMsg = lang === "en"
                ? `Switch to model "${chosen}"? Llama-server will restart with this model.`
                : `Chuyển sang mô hình "${chosen}"? Quá trình tải mô hình vào bộ nhớ sẽ mất một chút thời gian.`;

            if (confirm(promptMsg)) {
                if (statusBanner) {
                    statusBanner.className = "status-banner";
                    statusBanner.textContent = lang === "en"
                        ? `Switching to ${chosen}… Loading into memory.`
                        : `Đang chuyển sang ${chosen}… Vui lòng đợi nạp vào bộ nhớ.`;
                }
                applyHealth({ llm_ready: false, message: "Đang tải mô hình mới..." });

                try {
                    await fetch("/api/models/select", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ model: chosen }),
                    });
                    setTimeout(checkHealth, 3000);
                } catch (err) {
                    console.error("Error switching model:", err);
                }
            } else {
                // Revert to previously selected
                checkHealth();
            }
        });
    }

    loadModelsList();
    initModelSwitcher();

    return { applyHealth, checkHealth, updateHealthSpeedDisplay, loadModelsList };
}

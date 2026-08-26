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

    return { applyHealth, checkHealth, updateHealthSpeedDisplay };
}

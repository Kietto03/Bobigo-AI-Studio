/* Bobigo admin console: cluster monitoring, AI governance, users & audit log. */
(function () {
    "use strict";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
    const fmt = (iso) => iso ? new Date(iso).toLocaleString() : "—";
    const fmtNum = (n) => Number(n || 0).toLocaleString();
    const api = async (url, opts) => {
        const r = await fetch(url, Object.assign({ headers: { "Content-Type": "application/json" } }, opts));
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.status === 204 ? null : r.json();
    };

    let me = null;
    let monTimer = null;

    async function boot() {
        try {
            me = (await (await fetch("/api/auth/me", { cache: "no-store" })).json()).user;
        } catch (e) { me = null; }
        if (!me) { location.href = "/"; return; }
        if (me.role !== "admin") { alert("Bạn không có quyền quản trị."); location.href = "/"; return; }
        document.getElementById("admin-whoami").textContent = `${me.username} (admin)`;

        document.getElementById("admin-logout").addEventListener("click", async () => {
            try { await fetch("/api/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
            location.href = "/";
        });

        document.getElementById("admin-theme-toggle").addEventListener("click", () => {
            const toLight = document.body.classList.contains("dark");
            try { localStorage.setItem("bobigo_theme", toLight ? "daylight" : "obsidian"); } catch (e) { /* ignore */ }
            document.body.classList.remove("dark", "light", "theme-indigo", "theme-evergreen", "theme-amethyst", "theme-porcelain");
            document.body.classList.add(toLight ? "light" : "dark");
        });

        document.querySelectorAll(".admin-tab").forEach((t) => t.addEventListener("click", () => {
            const key = t.dataset.tab;
            switchTab(key);
        }));

        document.getElementById("mon-refresh-btn").addEventListener("click", loadMonitoring);
        document.getElementById("gov-refresh-btn").addEventListener("click", loadGovernance);
        document.getElementById("create-user-form").addEventListener("submit", createUser);
        const keyForm = document.getElementById("create-key-form");
        if (keyForm) keyForm.addEventListener("submit", createApiKey);

        // Initial tab
        switchTab("monitoring");
    }

    function switchTab(key) {
        document.querySelectorAll(".admin-tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === key));
        document.querySelectorAll(".admin-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === key));

        if (monTimer) { clearInterval(monTimer); monTimer = null; }

        if (key === "monitoring") {
            loadMonitoring();
            monTimer = setInterval(loadMonitoring, 10000);
        } else if (key === "governance") {
            loadGovernance();
        } else if (key === "apikeys") {
            loadApiKeys();
        } else if (key === "users") {
            loadUsers();
        } else if (key === "audit") {
            loadAudit();
        }
    }

    // -----------------------------------------------------------------------
    // 1. MONITORING
    // -----------------------------------------------------------------------

    /** Resolve a friendly display name from model hash or raw identifier. */
    function friendlyModelName(raw) {
        if (!raw) return "Không xác định";
        // If it's a sha256 hash, abbreviate
        if (raw.startsWith("sha256-") && raw.length > 20) {
            return raw.substring(0, 16) + "…";
        }
        // If it contains path separators, take last segment
        if (raw.includes("/")) {
            return raw.split("/").pop();
        }
        return raw;
    }

    async function loadMonitoring() {
        try {
            const data = await api("/api/admin/monitoring");
            const cluster = data.cluster || {};
            const host = cluster.host || {};
            const worker = cluster.worker || {};
            const llm = data.llm || {};
            const db = data.db || {};
            const storage = data.storage || {};

            // Host Node
            document.getElementById("host-ip").textContent = host.ip || "127.0.0.1";
            document.getElementById("host-ram").textContent = host.total_ram_gb ? `${host.total_ram_gb} GB` : "—";
            document.getElementById("host-uptime").textContent = host.uptime || "—";
            const platform = host.platform || "";
            document.getElementById("host-platform").textContent = platform.includes("macOS") ? "macOS Apple Silicon" : platform.split("-")[0] || "—";

            // Interconnect & Mode
            const clusterBadge = document.getElementById("cluster-mode-badge");
            const latencyBadge = document.getElementById("cluster-latency");
            if (worker.online) {
                clusterBadge.textContent = "Dual-Mac Cluster";
                clusterBadge.className = "bridge-stat bridge-mode";
                latencyBadge.innerHTML = `<i class="fa-solid fa-bolt"></i> ${worker.ping_ms ? worker.ping_ms + "ms" : "<1ms"}`;
            } else {
                clusterBadge.textContent = "Standalone";
                clusterBadge.className = "bridge-stat bridge-mode";
                latencyBadge.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Offline`;
                latencyBadge.className = "bridge-stat";
                latencyBadge.style.background = "rgba(239,68,68,0.10)";
                latencyBadge.style.color = "#ef4444";
            }

            // Worker Node
            const workerTag = document.getElementById("worker-status-tag");
            const workerPing = document.getElementById("worker-ping");
            const workerPort = document.getElementById("worker-port-status");
            document.getElementById("worker-ip").textContent = `${worker.ip || "192.168.100.2"}:${worker.port || 50052}`;

            if (worker.online) {
                workerTag.textContent = "Online";
                workerTag.className = "status-pill status-online";
                workerPing.textContent = worker.ping_ms ? `${worker.ping_ms} ms` : "< 1 ms";
                workerPort.textContent = "Listening";
                workerPort.className = "prop-val text-success";
            } else {
                workerTag.textContent = "Offline";
                workerTag.className = "status-pill status-offline";
                workerPing.textContent = "Không phản hồi";
                workerPort.textContent = "Chưa bật";
                workerPort.className = "prop-val text-warning";
            }

            // LLM Engine — use friendly name, truncate hashes
            const displayName = friendlyModelName(llm.model_name);
            const llmNameEl = document.getElementById("llm-model-name");
            llmNameEl.textContent = displayName;
            llmNameEl.title = llm.model_name || ""; // full name on hover

            document.getElementById("llm-model-meta").textContent = llm.online
                ? "llama-server · Metal GPU · Jinja"
                : "Server chưa sẵn sàng";

            document.getElementById("llm-params").textContent = llm.n_params
                ? `${(llm.n_params / 1e9).toFixed(1)}B`
                : "—";
            document.getElementById("llm-quant").textContent = llm.quantization || "—";
            document.getElementById("llm-ctx").textContent = llm.context_window
                ? `${llm.context_window.toLocaleString()} ctx`
                : "—";

            // Database
            const dbStatusEl = document.getElementById("db-status-val");
            if (db.status === "connected") {
                dbStatusEl.textContent = "Đã kết nối";
                dbStatusEl.className = "kpi-value text-success";
            } else {
                dbStatusEl.textContent = "Offline";
                dbStatusEl.className = "kpi-value text-danger";
            }
            document.getElementById("db-users-cnt").textContent = fmtNum(db.users_count);
            document.getElementById("db-sessions-cnt").textContent = fmtNum(db.sessions_count);
            document.getElementById("db-msgs-cnt").textContent = fmtNum(db.messages_count);
            document.getElementById("db-projects-cnt").textContent = fmtNum(db.projects_count);
            document.getElementById("db-companions-cnt").textContent = fmtNum(db.companions_count);
            document.getElementById("db-audit-cnt").textContent = fmtNum(db.audit_count);

            // Storage
            document.getElementById("storage-mb").textContent = `${storage.genfiles_mb || 0} MB`;
            document.getElementById("storage-files-cnt").textContent = fmtNum(storage.genfiles_count);

        } catch (err) {
            console.error("Monitoring fetch error:", err);
        }
    }

    // -----------------------------------------------------------------------
    // 2. GOVERNANCE
    // -----------------------------------------------------------------------
    async function loadGovernance() {
        try {
            const data = await api("/api/admin/governance");
            const summary = data.summary || {};
            const guardrails = data.guardrails || {};

            // KPIs
            document.getElementById("gov-total-docs").textContent = fmtNum(summary.total_documents);
            document.getElementById("gov-ocr-docs").textContent = fmtNum(summary.ocr_processed_documents);
            document.getElementById("gov-total-pii").textContent = fmtNum(summary.total_pii_detected);
            document.getElementById("gov-redaction-rate").textContent = `${summary.redaction_rate_pct || 100}%`;

            // Sensitivity Breakdown
            const sensBox = document.getElementById("gov-sens-bars");
            const sens = summary.sensitivity_breakdown || {};
            const total = summary.total_documents || 1;
            const labels = [
                { key: "public", name: "Public", cls: "sens-public", color: "#10b981" },
                { key: "internal", name: "Internal", cls: "sens-internal", color: "#6366f1" },
                { key: "confidential", name: "Confidential", cls: "sens-confidential", color: "#f59e0b" },
                { key: "restricted", name: "Restricted", cls: "sens-restricted", color: "#ef4444" },
            ];

            sensBox.innerHTML = labels.map((l) => {
                const count = sens[l.key] || 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return `
                    <div class="sens-row">
                        <div class="sens-row-head">
                            <span class="sens-badge ${l.cls}">${esc(l.name)}</span>
                            <span class="sens-count">${count} tệp (${pct}%)</span>
                        </div>
                        <div class="sens-progress-track">
                            <div class="sens-progress-bar" style="width: ${Math.max(pct, count > 0 ? 5 : 0)}%; background: ${l.color};"></div>
                        </div>
                    </div>`;
            }).join("");

            // PII Types Breakdown
            const piiBox = document.getElementById("gov-pii-types");
            const piiTypes = summary.pii_types || {};
            const piiEntries = Object.entries(piiTypes);
            if (!piiEntries.length) {
                piiBox.innerHTML = '<div class="admin-empty-sm"><i class="fa-solid fa-circle-check text-success"></i> Chưa phát hiện PII nhạy cảm.</div>';
            } else {
                piiBox.innerHTML = `<div class="pii-chips-grid">` + piiEntries.map(([t, cnt]) => `
                    <div class="pii-chip">
                        <span><i class="fa-solid fa-id-badge"></i> ${esc(t)}</span>
                        <span class="pii-chip-badge">${fmtNum(cnt)}</span>
                    </div>`).join("") + `</div>`;
            }

            // Tools Table
            const toolsTable = document.getElementById("gov-tools-table");
            const tools = guardrails.allowed_tools || [];
            toolsTable.innerHTML = tools.map((tool) => `
                <tr>
                    <td><strong><i class="fa-solid fa-wrench" style="color:var(--brand);margin-right:5px;font-size:0.72rem"></i>${esc(tool.name)}</strong></td>
                    <td>${esc(getProtectionDesc(tool.id))}</td>
                    <td><span class="risk-badge risk-${(tool.risk || "low").toLowerCase().replace(/[^a-z]/g, '')}">${esc(tool.risk)}</span></td>
                    <td><span class="status-pill status-online"><i class="fa-solid fa-check"></i> ${esc(tool.status)}</span></td>
                </tr>`).join("");

            // Compliance
            const compBox = document.getElementById("gov-compliance-list");
            const compliance = guardrails.compliance || [];
            compBox.innerHTML = compliance.map((c) => `
                <div class="comp-card">
                    <div class="comp-icon"><i class="fa-solid fa-shield-check"></i></div>
                    <div>
                        <div class="comp-title">${esc(c.name)}</div>
                        <div class="comp-status"><i class="fa-solid fa-circle-check text-success"></i> ${esc(c.status)}</div>
                    </div>
                </div>`).join("");

        } catch (err) {
            console.error("Governance fetch error:", err);
        }
    }

    function getProtectionDesc(toolId) {
        switch (toolId) {
            case "web_search": return "Bộ lọc truy vấn an toàn, chặn domain độc hại, giới hạn 5 kết quả.";
            case "calculator": return "AST parser an toàn, không dùng eval(), phòng ngừa injection.";
            case "python_repl": return "Subprocess isolated, timeout 10s & CPU/RAM limit.";
            case "file_reader": return "Tự động quét PII, phân loại và che dấu trước khi đưa vào ngữ cảnh.";
            case "mcp": return "Xác thực JSON-RPC qua stdio/SSE theo danh mục phê duyệt.";
            default: return "Kiểm soát quyền và giới hạn thời gian chạy.";
        }
    }

    // -----------------------------------------------------------------------
    // 3. API KEYS MANAGEMENT
    // -----------------------------------------------------------------------
    async function loadApiKeys() {
        const wrap = document.getElementById("keys-table");
        if (!wrap) return;
        wrap.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách API Key…</div>';
        try {
            const res = await api("/api/admin/api-keys");
            const keys = res.keys || [];
            if (!keys.length) {
                wrap.innerHTML = '<div class="admin-empty">Chưa có API Key nào được tạo.</div>';
                return;
            }
            const rows = keys.map((k) => `
                <tr>
                    <td><strong>${esc(k.name)}</strong></td>
                    <td><code class="mono" style="background:rgba(var(--brand-rgb),0.08);padding:3px 8px;border-radius:4px;font-size:0.8rem">${esc(k.key)}</code></td>
                    <td><span class="role-badge role-admin">${esc(k.username || "admin")}</span></td>
                    <td>${fmt(k.created_at)}</td>
                    <td>${fmt(k.last_used)}</td>
                    <td>${k.disabled ? '<span class="tag-off"><i class="fa-solid fa-lock"></i> Vô hiệu</span>' : '<span class="tag-on"><i class="fa-solid fa-circle-check"></i> Hoạt động</span>'}</td>
                    <td class="row-actions">
                        <button class="copy-key-btn" data-key="${esc(k.key)}" title="Sao chép Key"><i class="fa-solid fa-copy"></i></button>
                        <button data-act="del-key" data-id="${k.id}" title="Xoá Key" class="danger"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`).join("");
            wrap.innerHTML = `<table class="admin-table">
                <thead><tr><th>Tên / Mục đích</th><th>Khóa API (Token)</th><th>Người tạo</th><th>Tạo lúc</th><th>Dùng gần nhất</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
                <tbody>${rows}</tbody></table>`;
            
            wrap.querySelectorAll("button[data-act='del-key']").forEach((b) => b.addEventListener("click", async () => {
                if (!confirm("Xoá API Key này? Ứng dụng đang dùng key này sẽ mất quyền truy cập.")) return;
                try {
                    await api(`/api/admin/api-keys/${b.dataset.id}`, { method: "DELETE" });
                    loadApiKeys();
                } catch (e) { alert("Lỗi: " + e.message); }
            }));

            wrap.querySelectorAll(".copy-key-btn").forEach((b) => b.addEventListener("click", () => {
                navigator.clipboard.writeText(b.dataset.key);
                const icon = b.querySelector("i");
                icon.className = "fa-solid fa-check text-success";
                setTimeout(() => { icon.className = "fa-solid fa-copy"; }, 1500);
            }));
        } catch (err) {
            wrap.innerHTML = `<div class="admin-error">Lỗi: ${esc(err.message)}</div>`;
        }
    }

    async function createApiKey(e) {
        e.preventDefault();
        const msg = document.getElementById("ck-msg");
        msg.textContent = "";
        try {
            const name = document.getElementById("ck-name").value;
            const custom = document.getElementById("ck-custom").value;
            await api("/api/admin/api-keys", {
                method: "POST",
                body: JSON.stringify({ name: name, key: custom || undefined }),
            });
            document.getElementById("ck-name").value = "";
            document.getElementById("ck-custom").value = "";
            msg.textContent = "Đã tạo API Key thành công ✓";
            loadApiKeys();
        } catch (err) { msg.textContent = "Lỗi: " + err.message; }
    }

    // -----------------------------------------------------------------------
    // 4. USERS MANAGEMENT
    // -----------------------------------------------------------------------
    async function loadUsers() {
        const wrap = document.getElementById("users-table");
        wrap.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách…</div>';
        try {
            const users = (await api("/api/admin/users")).users;
            const rows = users.map((u) => `
                <tr class="${u.disabled ? "row-disabled" : ""}">
                    <td><strong>${esc(u.username)}</strong></td>
                    <td><span class="role-badge role-${u.role}">${u.role}</span></td>
                    <td>${fmtNum(u.chats)}</td>
                    <td>${fmt(u.created_at)}</td>
                    <td>${fmt(u.last_login)}</td>
                    <td>${u.disabled ? '<span class="tag-off"><i class="fa-solid fa-lock"></i> Khoá</span>' : '<span class="tag-on"><i class="fa-solid fa-circle-check"></i> OK</span>'}</td>
                    <td class="row-actions">
                        <button data-act="pw" data-id="${u.id}" title="Đổi mật khẩu"><i class="fa-solid fa-key"></i></button>
                        <button data-act="toggle" data-id="${u.id}" data-dis="${u.disabled ? 0 : 1}" title="${u.disabled ? "Mở khoá" : "Khoá"}"><i class="fa-solid fa-${u.disabled ? "unlock" : "lock"}"></i></button>
                        <button data-act="del" data-id="${u.id}" title="Xoá" class="danger"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`).join("");
            wrap.innerHTML = `<table class="admin-table">
                <thead><tr><th>Tên</th><th>Vai trò</th><th>Hội thoại</th><th>Tạo lúc</th><th>Login gần nhất</th><th>Trạng thái</th><th>Hành động</th></tr></thead>
                <tbody>${rows}</tbody></table>`;
            wrap.querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => userAction(b.dataset)));
        } catch (err) {
            wrap.innerHTML = `<div class="admin-error">Lỗi: ${esc(err.message)}</div>`;
        }
    }

    async function userAction(ds) {
        const id = ds.id;
        try {
            if (ds.act === "pw") {
                const pw = prompt("Nhập mật khẩu mới:");
                if (!pw) return;
                await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ password: pw }) });
            } else if (ds.act === "toggle") {
                await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ disabled: ds.dis === "1" }) });
            } else if (ds.act === "del") {
                if (!confirm("Xoá tài khoản này và toàn bộ dữ liệu liên quan?")) return;
                await api(`/api/admin/users/${id}`, { method: "DELETE" });
            }
            loadUsers();
        } catch (err) { alert("Lỗi: " + err.message); }
    }

    async function createUser(e) {
        e.preventDefault();
        const msg = document.getElementById("cu-msg");
        msg.textContent = "";
        try {
            await api("/api/admin/users", {
                method: "POST",
                body: JSON.stringify({
                    username: document.getElementById("cu-username").value,
                    password: document.getElementById("cu-password").value,
                    role: document.getElementById("cu-role").value,
                }),
            });
            document.getElementById("cu-username").value = "";
            document.getElementById("cu-password").value = "";
            msg.textContent = "Đã tạo tài khoản ✓";
            loadUsers();
        } catch (err) { msg.textContent = "Lỗi: " + err.message; }
    }

    // -----------------------------------------------------------------------
    // 4. AUDIT LOGS
    // -----------------------------------------------------------------------
    async function loadAudit() {
        const wrap = document.getElementById("audit-table");
        wrap.innerHTML = '<div class="admin-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải…</div>';
        try {
            const items = (await api("/api/admin/audit?limit=300")).items;
            if (!items.length) { wrap.innerHTML = '<div class="admin-empty">Chưa có bản ghi.</div>'; return; }
            const rows = items.map((it) => `
                <tr>
                    <td style="white-space:nowrap">${fmt(it.created_at)}</td>
                    <td><strong>${esc(it.username || "admin")}</strong></td>
                    <td title="${esc(it.filename)}"><i class="fa-regular fa-file"></i> ${esc(it.filename)}</td>
                    <td><span class="sens-badge sens-${it.sensitivity || "internal"}">${esc(it.sensitivity || "internal")}</span></td>
                    <td>${it.pii_count > 0 ? `<span class="tag-off"><i class="fa-solid fa-triangle-exclamation"></i> ${it.pii_count}</span>` : `<span class="tag-on">Sạch</span>`}</td>
                    <td>${it.ocr_used ? '<span class="mini-tag"><i class="fa-solid fa-eye"></i> OCR</span>' : '<span class="mini-tag">Text</span>'}</td>
                    <td>${it.summary_file_id ? `<a href="/api/files/${it.summary_file_id}?download=1" class="admin-btn-sm" title="Tải"><i class="fa-solid fa-download"></i></a>` : ""}</td>
                </tr>`).join("");
            wrap.innerHTML = `<table class="admin-table">
                <thead><tr><th>Thời gian</th><th>Người dùng</th><th>Tên tệp</th><th>Nhạy cảm</th><th>PII</th><th>Phương thức</th><th></th></tr></thead>
                <tbody>${rows}</tbody></table>`;
        } catch (err) {
            wrap.innerHTML = `<div class="admin-error">Lỗi: ${esc(err.message)}</div>`;
        }
    }

    document.addEventListener("DOMContentLoaded", boot);
})();

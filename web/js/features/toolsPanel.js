/**
 * Settings → Tools & MCP catalog panel.
 * Renders built-in tool descriptions and connected MCP server status;
 * owns the Reconnect button wiring. Extracted from main.js.
 */

import { getToolsCatalog } from "../api.js";

const TOOL_NOTES = {
    vi: {
        web_search: "Tìm web qua DuckDuckGo · dữ kiện mới",
        calculator: "Toán học AST an toàn (không eval)",
        code_interpreter: "Python sandbox · timeout 15s",
        url_reader: "Đọc trang web · chặn SSRF",
        list_files: "Liệt kê file trong workspace",
        read_file: "Đọc file text/PDF trong workspace",
        convert_to_markdown: "Chuyển tài liệu (Word/Excel/PPT/PDF…) sang Markdown · MarkItDown",
        create_file: "Tạo file text/code/markdown/CSV/HTML/SVG · xem trước & tải",
        create_docx: "Tạo tài liệu Word (.docx)",
        create_xlsx: "Tạo bảng tính Excel (.xlsx)",
    },
    en: {
        web_search: "Web search via DuckDuckGo · fresh facts",
        calculator: "Safe AST math (no eval)",
        code_interpreter: "Python sandbox · 15s timeout",
        url_reader: "Read web pages · blocks SSRF",
        list_files: "List workspace files",
        read_file: "Read workspace text/PDF files",
        convert_to_markdown: "Convert docs (Word/Excel/PPT/PDF…) to Markdown · MarkItDown",
        create_file: "Create text/code/markdown/CSV/HTML/SVG files · preview & download",
        create_docx: "Create a Word document (.docx)",
        create_xlsx: "Create an Excel spreadsheet (.xlsx)",
    },
};

let catalogLoaded = false;

/** Force the next refresh to re-fetch /api/tools (e.g. after MCP restart). */
export function invalidateCatalog() {
    catalogLoaded = false;
}

export async function refreshSettingsCatalog(lang = "vi") {
    if (catalogLoaded) return; // fetch once per drawer-open session
    const toolsEl = document.getElementById("tools-builtin-list");
    const mcpEl = document.getElementById("mcp-servers-list");
    if (!toolsEl && !mcpEl) return;
    const notes = TOOL_NOTES[lang] || TOOL_NOTES.vi;
    const data = await getToolsCatalog();
    catalogLoaded = true;
    if (toolsEl) {
        toolsEl.innerHTML = (data.builtin || []).map((t) => `
            <div class="tool-entry">
                <div class="tool-entry-name"><i class="fa-solid fa-wrench"></i> ${t.name || ""}</div>
                <div class="tool-entry-desc">${notes[t.name] || t.description || ""}</div>
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
                        <strong>${s.name || ""}</strong>
                        <span class="mcp-status">${s.connected ? ((s.tools || []).length + " tools") : (s.error || "offline")}</span>
                    </div>
                    ${(s.tools || []).length ? `<div class="mcp-tools">${(s.tools || []).map((t) => `<span class="chiptag">${t.name || ""}</span>`).join("")}</div>` : ""}
                </div>`).join("");
        }
    }
}

/** Wire the MCP Reconnect button once (idempotent). */
export function wireMcpReconnect(lang = "vi") {
    const reconnectBtn = document.getElementById("mcp-reconnect");
    if (!reconnectBtn || reconnectBtn.dataset.wired) return;
    reconnectBtn.dataset.wired = "1";
    reconnectBtn.addEventListener("click", async () => {
        reconnectBtn.disabled = true;
        const list = document.getElementById("mcp-servers-list");
        if (list) list.innerHTML = `<div class="mcp-empty">${lang === "en" ? "Reconnecting…" : "Đang kết nối lại…"}</div>`;
        try {
            await fetch("/api/mcp/restart", { method: "POST" });
        } catch (e) { /* surfaced by the refreshed status below */ }
        invalidateCatalog();
        await refreshSettingsCatalog(lang);
        reconnectBtn.disabled = false;
    });
}

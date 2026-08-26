# 🤖 Bobigo AI Studio — Local AI Agent Workbench

<p align="center">
  <img src="web/logo.png" alt="Bobigo AI" width="128" height="128">
</p>

<p align="center">
  <b>Trợ lý AI Agent chạy 100% cục bộ trên Apple Silicon — llama-server (Metal GPU) + FastAPI + PostgreSQL</b>
</p>

---

## 🌟 Giới thiệu

**Bobigo AI Studio** là workbench chat + agent chạy hoàn toàn trên máy của bạn:

- **LLM:** `llama-server` (llama.cpp, Metal GPU, `--jinja` để gọi tool).
- **Backend:** FastAPI — proxy thông minh, agent loop streaming (SSE), persistence.
- **Frontend:** Vanilla JS (ES modules), không cần build step; mọi thư viện self-host trong `web/vendor/`.
- **Dữ liệu:** PostgreSQL (Docker) làm store chính; trình duyệt tự fallback về **IndexedDB** khi DB không khả dụng.

Không cloud, không API key, không telemetry.

---

## ✨ Tính năng

### 🧠 Agent loop tự chủ (tool calling)
Vòng lặp đa bước (tối đa `MAX_AGENT_ITERATIONS`) với streaming SSE realtime. Bobigo tự gọi tool khi cần, hiển thị tiến trình từng lần gọi ngay trong chat:

| Tool | Chức năng | Giới hạn an toàn |
|------|-----------|------------------|
| `web_search` | Tìm web qua DuckDuckGo HTML | Tối đa `MAX_SEARCH_RESULTS`, timeout |
| `calculator` | Biểu thức toán, căn, lũy thừa, lượng giác | AST parser — **không dùng `eval`** |
| `code_interpreter` | Chạy Python, bắt stdout | Sandbox `-I`, chặn reflection/dunder/import nguy hiểm, **timeout 15s**, không mạng |
| `url_reader` | Đọc nội dung văn bản của trang web | Chặn SSRF (loopback/private IP), giới hạn dung lượng & redirect |
| `list_files` / `read_file` | Duyệt & đọc file trong workspace | Chặn `.env`, secret, thư mục nhạy cảm |
| `create_file` / `create_docx` / `create_xlsx` | Agent sinh file để bạn tải về | Ghi giới hạn trong thư mục `generated/` |
| `convert_to_markdown` | Chuyển tài liệu (pdf/docx/html…) sang Markdown | Qua MarkItDown |

Khi llama-server trả lỗi 500 giữa chừng (tool call hỏng), agent loop **tự thử lại không có tool** để vẫn đưa ra câu trả lời.

### 👥 Companions & 📁 Projects
- **Companion:** nhân vật AI riêng (tính cách, hướng dẫn, kiến thức, ảnh/emoji) với một luồng chat liên tục.
- **Project:** nhóm các đoạn chat quanh một chủ đề chung (hướng dẫn + kiến thức dùng chung).
- Kiến thức được nhúng thẳng vào system prompt theo token budget (~40–45% cửa sổ) — không cần embeddings/RAG.

### 💬 Chat experience
- Streaming từng token, nút dừng, ô **suy luận** (thinking) riêng biệt.
- **Regenerate variants:** tạo lại ở mức nhiệt khác (sáng tạo/chính xác hơn) và so sánh các phiên bản bằng bộ chuyển `‹ 2/2 ›`.
- Ghim tin nhắn, tìm kiếm trong hội thoại (kèm lọc "chỉ tin đã ghim"), branch/đổi tên cuộc trò chuyện.
- **Context meter:** thanh đo token đã dùng / context window, đồng bộ budget với backend; **tự nén hội thoại** khi gần đầy (tóm tắt phần cũ thành bản ghi nhớ).
- Xuất hội thoại `.md` / `.json`, đính kèm tệp (extract qua `/api/extract-file`, chuyển Markdown qua `/api/to-markdown`).

### 🌐 Song ngữ & giao diện
- Tiếng Việt ⬄ English: UI, system prompt và tool hint đổi theo ngôn ngữ.
- Dark/Light themes + skin **style-pixel** (font Pixelify Sans).
- Prompt library: preset system prompt + slash-command (`/summarize`, `/translate`, `/bullets`…), lưu snippet riêng.

---

## 🔌 Công cụ & MCP (Model Context Protocol)

### Công cụ tích hợp (Bobigo tự gọi khi cần)

| Tool | Chức năng | Giới hạn an toàn |
|------|-----------|------------------|
| `web_search` | Tìm web qua DuckDuckGo HTML | Ẩn danh, tối đa 10 kết quả |
| `calculator` | Tính biểu thức toán học | AST an toàn, **không `eval`** |
| `code_interpreter` | Chạy Python | Sandbox cô lập (`-I`), chặn reflection/dunder, **timeout 15s**, không mạng/không file |
| `url_reader` | Đọc văn bản trang web | Chặn SSRF (loopback/IP nội bộ), giới hạn dung lượng |
| `list_files` / `read_file` | Duyệt & đọc file trong repo | Chặn `.env`, khóa, thư mục nhạy cảm |

> Xem đầy đủ ngay trong app: nút **Công cụ & MCP** (biểu tượng cờ-lê) trên thanh điều hướng.

### Kết nối MCP server ngoài

Bobigo là một **MCP client**: tạo `mcp.json` ở gốc repo để nạp thêm tool từ các MCP server (stdio). Tool của chúng được đưa vào agent loop dưới tên `mcp_<server>_<tool>`.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/duong/dan/cho/phep"]
    }
  }
}
```

> ⚠️ **Bảo mật:** MCP server chạy như tiến trình con với quyền của bạn. Chỉ khai báo server tin cậy. Không có `mcp.json` → tính năng tắt hoàn toàn (mặc định). File này được `.gitignore`.

---

---

## 🏗️ Kiến trúc

```
┌────────────┐   SSE /v1/chat/completions   ┌───────────────────────────┐
│  Browser   │ ───────────────────────────► │  FastAPI (backend/app.py) │
│  web/      │ ◄─────────────────────────── │  agent loop · proxy · API │
└─────┬──────┘        stream chunks          └────────┬─────────┬────────┘
      │ IndexedDB fallback (offline cache)            │         │
      │                                     HTTP ▼    │         ▼ asyncpg
      └──── sync sessions/companions/projects ──► llama-server   PostgreSQL :5433
                                                  :11434
```

```
.
├── run.sh                    # All-in-one launcher (DB + llama-server + web UI)
├── server.py                 # Static file server đơn giản cho web/ (port 8000)
├── docker-compose.yml        # PostgreSQL 16 (chỉ bind loopback :5433)
├── pytest.ini · requirements.txt · mcp.json (tuỳ chọn, gitignored)
├── backend/
│   ├── config.py             # Env config (URL, budget, giới hạn)
│   ├── app.py                # FastAPI routes: SSE agent, proxy, store, uploads
│   ├── health.py             # Probe llama-server (/health, /props, jinja check)
│   ├── agent/
│   │   ├── loop.py           # stream_agent(): vòng lặp tool-calling + SSE
│   │   ├── parse.py          # Bóc tool calls từ output model (jinja/XML)
│   │   ├── context.py        # Trim lịch sử theo token budget
│   │   └── compress.py       # Tóm tắt hội thoại cũ bằng LLM
│   ├── db/
│   │   ├── pool.py           # asyncpg pool (None nếu DB down → app vẫn chạy)
│   │   ├── repo.py           # Reconcile Sessions / Companions / Projects
│   │   └── schema.sql
│   ├── mcp/
│   │   ├── client.py         # JSON-RPC 2.0 over stdio
│   │   └── manager.py        # Vòng đời server + gộp tool schemas vào agent
│   └── tools/                # calculator · code_interpreter · files · genfiles
│                             # filegen · markdown_convert · url_reader · web_search
├── web/
│   ├── index.html · style.css · i18n.js (từ điển VI/EN)
│   ├── companions.js · projects.js
│   ├── js/                   # api · config · db (IndexedDB) · main · markdown · tokens · util
│   │   └── features/         # contextMeter · messageSearch · promptLibrary
│   │                         # appearance · toolsPanel · healthPanel · focusTrap
│   └── vendor/               # marked · DOMPurify · highlight.js · FontAwesome · fonts
│                             # (fetch lại bằng ./scripts/fetch_vendor.sh)
├── scripts/
│   ├── start_backend.sh      # llama-server Metal GPU + --jinja
│   ├── fetch_vendor.sh       # Tải vendor assets vào web/vendor/
│   └── smoke_agent.py        # Smoke-test agent không cần UI
└── tests/                    # Unit tests (pytest)
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### 1. Yêu cầu Hệ thống
* **Hệ điều hành:** macOS (khuyên dùng Apple Silicon M1–M4, 16GB+ RAM) hoặc Linux.
* **Môi trường:** Python 3.10+, `llama-server` ([llama.cpp](https://github.com/ggml-org/llama.cpp)) trong `PATH`.
* **Docker Desktop** (tuỳ chọn): cho PostgreSQL. Không có Docker → app vẫn chạy offline hoàn toàn bằng IndexedDB trong trình duyệt.

### 2. Cài đặt Dependencies (chỉ cần làm lần đầu)
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Vendor assets frontend (marked, DOMPurify, highlight.js, FontAwesome, fonts) đã được commit trong `web/vendor/`. Muốn nâng cấp phiên bản thì chạy lại:
```bash
./scripts/fetch_vendor.sh
```

### 3. Mô hình GGUF
Đặt biến `MODEL_PATH`, hoặc để script tự tìm blob >10GB trong `~/.ollama/models/`:
```bash
export MODEL_PATH=/path/to/model.gguf   # vd: qwen3 35B 4-bit
```

### 4. Khởi chạy (1-Click)
```bash
./run.sh
```

Script sẽ tự động:
1. `docker compose up -d db` — PostgreSQL trên `127.0.0.1:5433` (bỏ qua nếu không có Docker).
2. Nạp model vào **`llama-server`** tại `127.0.0.1:11434` (`-ngl 99 --jinja`), chờ tới khi sẵn sàng.
3. Mở Web UI server trên cổng `8000` và trình duyệt tại: **http://localhost:8000**

Chỉ cần backend LLM? `bash scripts/start_backend.sh`.

### Chạy bằng Docker (tuỳ chọn, cho máy không phải macOS/Metal)

```bash
docker compose --profile full up -d --build
```

Container chạy FastAPI + web UI tại `http://localhost:8000` và dùng Postgres trong compose; llama-server vẫn chạy trên host (Metal/CUDA) và được trỏ tới qua `host.docker.internal` (đổi bằng `LLM_BASE_URL=...` nếu LLM ở máy khác).

### Biến môi trường hữu ích

| Biến | Mặc định | Ý nghĩa |
|------|----------|---------|
| `MODEL_PATH` | auto-detect | Đường dẫn file GGUF cho llama-server |
| `LLM_BASE_URL` | `http://127.0.0.1:11434` | Endpoint OpenAI-compatible của llama-server |
| `DATABASE_URL` | `postgresql://bobigo:bobigo@127.0.0.1:5433/bobigo` | PostgreSQL store |
| `CONTEXT_WINDOW` | `8192` | Token budget (nên khớp `-c` của llama-server) |
| `HOST` / `PORT` | `127.0.0.1` / `8000` | Địa chỉ bind của web server |
| `MAX_UPLOAD_BYTES` | `26214400` (25MB) | Giới hạn upload server-side |

---

## 🧪 Chạy Kiểm thử Tự động (Testing)

```bash
.venv/bin/pytest -v
```

Bộ test bao gồm: an toàn Calculator AST, Code Sandbox, tool-call parsing, agent loop (iteration cap, fallback khi llama-server trả 500 giữa chừng), context trimming, compression, MCP client, SSRF filter + DNS-rebinding guard, web search parser, store endpoints và upload extraction.

Lint & CI: `ruff check .` (config trong `pyproject.toml`) — GitHub Actions chạy pytest + ruff + syntax-check frontend cho mỗi push/PR. Cài đặt tái lập đúng môi trường CI: `.venv/bin/pip install -r requirements.lock.txt`. Hướng dẫn đóng góp: `CONTRIBUTING.md`, lịch sử thay đổi: `CHANGELOG.md`.

---

## 🛡️ An toàn & Bảo mật

- **100% cục bộ:** dữ liệu hội thoại nằm trên máy bạn (PostgreSQL local + IndexedDB); không telemetry.
- **Bind loopback:** cả web server lẫn Postgres chỉ nghe `127.0.0.1`, không lộ ra LAN.
- **Calculator AST:** không dùng hàm `eval()` nguy hiểm.
- **Python sandbox:** isolated mode `-I`, chặn import nguy hiểm & reflection/dunder, timeout 15s, không mạng.
- **SSRF filter:** `url_reader` chặn loopback/private IP, giới hạn redirect và dung lượng response.
- **XSS fail-closed:** mọi output model đi qua DOMPurify trước khi render; nếu thiếu sanitizer, app render plain-text escaped thay vì HTML thô.
- **Upload limit:** server trả HTTP 413 khi tệp vượt `MAX_UPLOAD_BYTES` — không phụ thuộc check phía browser.
- **Workspace guard:** `read_file`/`list_files` chặn `.env`, secret keys, thư mục hệ thống.
- **MCP:** server ngoài chạy như tiến trình con với quyền của bạn — chỉ khai báo server tin cậy.

---

## 📄 License

MIT — xem [`LICENSE`](LICENSE). Vendors bên thứ ba trong `web/vendor/` giữ giấy phép riêng của họ (MIT/Apache — ghi trong từng file).


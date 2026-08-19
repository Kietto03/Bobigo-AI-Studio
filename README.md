# 🤖 Bobigo AI Studio — Local AI Agent & Roleplay Studio

<p align="center">
  <img src="web/logo.png" alt="Bobigo AI" width="128" height="128">
</p>

<p align="center">
  <b>Trợ lý AI Agent & Studio Nhập vai Đa năng chạy 100% Offline trên Apple Silicon Metal GPU</b>
</p>

---

## 🌟 Giới thiệu

**Bobigo AI Studio** là ứng dụng AI Agent và Trò chuyện cục bộ thế hệ mới, kết hợp sức mạnh của mô hình ngôn ngữ lớn chạy trực tiếp trên máy Mac (qua `llama-server` tăng tốc C++ Metal GPU) cùng kiến trúc Agent thông minh tự chủ gọi công cụ (Tool Calling / ReAct Loop) và chế độ nhập vai tương tác sâu (Multi-character Roleplay).

---

## ✨ Tính năng Nổi bật

### 1. 🧠 Autonomous AI Agent & ReAct Tool Calling
* **Tự động suy luận & gọi công cụ (Loop lặp đa bước):**
  - 🌐 `web_search`: Tìm kiếm thông tin thực tế từ internet ẩn danh qua DuckDuckGo HTML Lite.
  - 🔢 `calculator`: Tính toán biểu thức toán học, căn thức, lượng giác và lũy thừa chính xác tuyệt đối qua AST Parser an toàn (không dùng `eval`).
  - 🐍 `code_interpreter`: Chạy mã Python trong môi trường sandbox cô lập có kiểm soát thời gian timeout.
  - 🔗 `url_reader`: Trích xuất và đọc nội dung văn bản sạch từ các trang web (hỗ trợ chặn SSRF mạng nội bộ).
  - 📁 `list_files` & `read_file`: Đọc và duyệt cấu trúc thư mục workspace trong dự án.

### 2. 🎭 Chế độ Roleplay Đa Nhân Vật & Kịch bản (World & Cast Studio)
* **Quản lý Kịch bản & Nhân vật (Cast):** Cấu hình tính cách, ngoại hình, cách xưng hô, mục tiêu và ví dụ câu thoại cho từng nhân vật.
* **Ký ức phiên độc lập (Session-scoped Memory):** AI tự động trích xuất và ghim các sự kiện quan trọng bằng cú pháp `<<nhớ: ...>>` (hoặc `<<remember: ...>>`).
* **Trợ lý Tạo thế giới AI (World Expander):** Nhập mô tả ngắn gọn, Bobigo sẽ tự động tạo hồ sơ thế giới JSON chi tiết (bối cảnh, thời đại, phe phái, luật lệ, nhân vật).

### 3. 🌐 Hỗ trợ Song ngữ Toàn diện (Tiếng Việt & English)
* Chuyển đổi 1-click giữa **Tiếng Việt (VI)** và **English (EN)**.
* Tự động điều chỉnh toàn bộ UI, System prompt, Tool hints và kịch bản Roleplay theo ngôn ngữ được chọn.

### 4. 🎨 Giao diện Người dùng Hiện đại (Obsidian & Crimson)
* **Giao diện Kép (Dual Theme):** Chuyển đổi mượt mà giữa Dark Mode (Obsidian Rose) và Light Mode.
* **Thinking Process Box:** Xem chi tiết luồng suy luận từng bước của mô hình AI (Chain of Thought).
* **Đính kèm Tệp tin (File Attachment 📎):** Nạp trực tiếp tệp mã nguồn để phân tích.
* **Xuất dữ liệu linh hoạt:** Xuất hội thoại hoặc kịch bản ra định dạng **Markdown (`.md`)** hoặc **JSON (`.json`)**.

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

## 🧠 Quản lý Context & Trải nghiệm Chat Hiện đại

* **Đồng hồ Context Window:** thanh đo % token đã dùng theo thời gian thực, cảnh báo khi gần đầy.
* **Tự động nén hội thoại:** khi vượt ngưỡng, Bobigo tóm tắt phần cũ thành *bản ghi nhớ* (giữ sự kiện/quyết định/tên) rồi lưu lại — không lặp lại việc tóm tắt mỗi lượt. Có thể nén thủ công bằng nút nén.
* **Tìm trong hội thoại & Ghim:** tìm tức thời trong đoạn chat, điều hướng kết quả, ghim tin quan trọng và lọc "chỉ tin đã ghim".
* **Thư viện Prompt:** lưu **system-prompt preset** tái dùng; **slash-command** (`/summarize`, `/translate`, `/bullets`…) ngay trong ô nhập.
* **Regenerate nâng cao:** tạo lại với mức nhiệt độ khác (sáng tạo hơn / chính xác hơn) và **so sánh nhiều phiên bản** trả lời bằng bộ chuyển `‹ 2/2 ›`.
* **Offline 100%:** toàn bộ font, icon và thư viện JS được **self-host** trong `web/vendor/` — không phụ thuộc CDN.

---

## 📁 Cấu trúc Thư mục Dự án

```
Chatbot_v1/
├── README.md               # Tài liệu dự án
├── run.sh                  # Script khởi chạy 1-click (All-in-one launcher)
├── server.py               # FastAPI backend: web UI, API proxy, ReAct loop & tools
├── requirements.txt        # Thư viện Python (FastAPI, uvicorn, httpx, pytest)
├── pytest.ini              # Cấu hình kiểm thử tự động
├── backend/                # Mã nguồn xử lý Agent & Tools
│   ├── config.py           # Cấu hình server, ports, LLM backend URL
│   ├── app.py              # Định tuyến FastAPI endpoints
│   ├── expand.py           # Bộ mở rộng kịch bản Roleplay bằng AI
│   ├── health.py           # Kiểm tra trạng thái llama-server
│   ├── roleplay.py         # Xây dựng System Prompt cho kịch bản Roleplay
│   ├── agent/              # ReAct Agent Core
│   │   ├── loop.py         # Vòng lặp Agent & SSE Streamer
│   │   ├── parse.py        # Parser bóc tách tool calls từ output LLM
│   │   ├── context.py      # Quản lý Context Window & Token Budget
│   │   └── compress.py     # Tóm tắt (nén) hội thoại cũ bằng LLM
│   ├── mcp/                # MCP client (kết nối server ngoài qua stdio)
│   │   ├── client.py       # JSON-RPC 2.0 stdio client
│   │   └── manager.py      # Quản lý server + gộp tool vào agent
│   └── tools/              # Bộ công cụ Agent (Tools)
│       ├── calculator.py   # Safe AST Math Evaluator
│       ├── code_interpreter.py # Python Sandbox Execution
│       ├── files.py        # Local File Operations
│       ├── url_reader.py   # Web Content Scraper & SSRF Filter
│       └── web_search.py   # DuckDuckGo HTML Search
├── mcp.json                # (Tùy chọn) Cấu hình MCP server — gitignored
├── tests/                  # Bộ kiểm thử Unit Test (57 test cases)
├── web/                    # Giao diện Web Frontend
│   ├── index.html          # Cấu trúc HTML giao diện
│   ├── style.css           # Hệ thống Style & Themes
│   ├── i18n.js             # Từ điển Song ngữ (VI/EN)
│   ├── roleplay.js         # Quản lý Trạng thái Roleplay & Ký ức
│   ├── js/                 # Frontend ES modules
│   │   ├── main.js         # Wire DOM, streaming, state
│   │   ├── api.js · config.js · markdown.js · util.js · tokens.js
│   │   └── features/       # contextMeter, messageSearch, promptLibrary,
│   │       │                 regenerate variants, toolsPanel
│   ├── vendor/             # Thư viện self-host (fonts, FA, marked, hljs…)
│   └── logo.png            # Logo Bobigo Avatar Retina 512x512
└── scripts/
    └── start_backend.sh    # Script khởi chạy llama-server với Metal GPU
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy (Quickstart)

### 1. Yêu cầu Hệ thống
* **Hệ điều hành:** macOS (khuyên dùng chip Apple Silicon M1/M2/M3/M4 với 16GB+ RAM).
* **Môi trường:** Python 3.10+ và công cụ `llama-server` (hoặc Ollama).

### 2. Cài đặt Dependencies (chỉ cần làm lần đầu)
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 3. Khởi chạy Ứng dụng (1-Click)
Chạy script chính:
```bash
./run.sh
```

Script sẽ tự động:
1. Phát hiện mô hình GGUF và bật **`llama-server`** trên cổng `11434` với tăng tốc Metal GPU (`-ngl 99`).
2. Khởi chạy FastAPI Web Server trên cổng `8000`.
3. Tự động mở trình duyệt tại: **`http://localhost:8000`**.

---

## 🧪 Chạy Kiểm thử Tự động (Testing)

Dự án đi kèm bộ 57 unit tests kiểm tra toàn diện tính an toàn của Calculator AST, Code Sandbox, Tool Parsing, Context Trimming, Compression, MCP client, URL Filtering và Roleplay Prompts:

```bash
.venv/bin/pytest -v
```

---

## 🛡️ An toàn & Bảo mật
* **Chạy Offline 100%:** Toàn bộ dữ liệu hội thoại và suy luận diễn ra trực tiếp trên máy của bạn.
* **Calculator AST:** Không sử dụng hàm `eval()` nguy hiểm.
* **URL Reader SSRF Protection:** Tự động chặn các yêu cầu đến IP loopback (`127.0.0.1`, `localhost`) hoặc dải IP nội bộ private (`10.x`, `192.168.x`).
* **Python Sandbox:** Giới hạn thời gian thực thi (timeout 15s) và chặn truy cập namespace không an toàn.

# Changelog

Format theo [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
version tuân theo [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `scripts/fetch_vendor.sh`: tải toàn bộ vendor assets frontend vào `web/vendor/`.
- Server-side upload limit (`MAX_UPLOAD_BYTES`, HTTP 413) cho `/api/extract-file` & `/api/to-markdown` + regression test.
- Garbage-collect thư mục `generated/` khi khởi động (`GENERATED_TTL_HOURS`, mặc định 72h).
- Structured logging cho backend (`BOBIGO_LOG_LEVEL`), thay các lệnh `print()` rải rác.
- Health probe dùng `GET /props` của llama-server để phát hiện `--jinja` (fallback quét `ps`).
- Guard chống DNS-rebinding trong `url_reader` (kiểm tra lại DNS trước khi đọc response body).
- Version constant (`backend.__version__`) và hiển thị trong `/api/health`.
- CI (GitHub Actions): pytest + ruff + syntax-check frontend; ruff config trong `pyproject.toml`; `.editorconfig`; pre-commit hooks; `requirements.lock.txt`; CHANGELOG & CONTRIBUTING.
- `POST /api/tokenize`: đếm token chính xác qua llama-server `/tokenize`, tự fallback về heuristic len/4 (`exact: false`) khi LLM down.
- Context meter dùng tokenizer thật: sau khi vẽ heuristic, frontend gọi `/api/tokenize` (debounce 700ms) để tinh chỉnh — tiêu đề hiện "· exact" khi là số thật.
- Opt-in Docker sandbox cho `code_interpreter`: `SANDBOX_RUNTIME=docker` (+`SANDBOX_IMAGE`) chạy mỗi snippet trong container `--network none`; builder tách hàm thuần và có test.
- **Persistence tăng dần phía client**: sau khi stream xong (và cả user msg), message được POST tới `/api/sessions/{id}/messages` fire-and-forget — crash trước lần sync bulk kế tiếp vẫn không mất chat. Bulk PUT giữ nguyên làm reconcile.
- **A11y**: focus-trap utility (`features/focusTrap.js` + test) cho modal Companions & Projects; `aria-label` cho các nút icon-only thiếu tên; `role="dialog" aria-modal` đã có từ trước.
- **Tách module khỏi main.js** (bước đầu của decomposition): `features/appearance.js` (theme/style registry + controller), `features/toolsPanel.js` (TOOL_NOTES, settings catalog, MCP reconnect) và `features/healthPanel.js` (health polling + status paint, shared-state bridge qua callback) — main.js giảm ~215 dòng (3,285 → 3,072), toàn bộ call site chuyển qua API module mới; syntax + 29 Vitest pass.
- Nền tảng persistence tăng dần: `POST /api/sessions/{id}/messages` (append không xoá-phục-hồi thread) và `DELETE /api/sessions/{id}` — client vẫn dùng bulk PUT, sẽ chuyển dần sang endpoint này.
- `POST /api/mcp/restart` + nút **Kết nối lại MCP** trong Settings → MCP (hồi phục server bị crash / config mới mà không cần restart backend).
- Frontend unit tests với **Vitest** (`npm test`) cho tokens/util/markdown/promptLibrary + contextMeter/messageSearch qua **happy-dom**; `.prettierrc.json`.
- **ESLint** (flat config) + script `npm run lint` + bước lint trong CI; **mypy** sạch toàn bộ backend (24 files) và chạy trong CI.
- Git repository khởi tạo với baseline commit; **LICENSE MIT**.
- **Huỷ streaming khi client ngắt kết nối**: `stream_agent(should_cancel=...)` kiểm tra giữa các vòng/tool — tab đóng là GPU nghỉ. Kèm unit test.
- E2E test SSE qua route thật với llama-server giả (`httpx.MockTransport`) — phủ trọn agent loop trong CI.
- Header bảo mật cho `/api/*` & `/v1/*` (nosniff / frame-options / referrer-policy); vendor assets được cache `immutable`, app code vẫn `no-cache`.
- MCP tự hồi phục: gọi tool trên server chết sẽ revive đúng server đó rồi thử lại một lần.
- Docker full-stack tuỳ chọn: `Dockerfile` + `docker compose --profile full up -d --build`; `Makefile` (venv/vendor/lint/test/run).

### Changed
- `renderMarkdown()` (frontend) fail-closed: thiếu DOMPurify → render plain-text escaped, không bao giờ trả HTML thô.
- README viết lại theo kiến trúc hiện tại (bỏ tham chiếu roleplay đã bị xoá).
- i18n: dọn ~93 key chết (UI roleplay cũ) khỏi cả hai ngôn ngữ.
- `web_search`: retry 1 lần khi trang kết quả rỗng/lỗi mạng và trả hàng lỗi tường minh thay vì fail im lặng.
- `scripts/start_backend.sh` đọc `CONTEXT_WINDOW` từ env — khớp `backend/config.py` (một nguồn chân lý duy nhất).

### Fixed
- Hai crash tiềm ẩn do thiếu import ở main.js (`createHealthController`, `estimateTokens`) — phát hiện nhờ ESLint.
- Trùng lặp key `penalty` trong cả hai pack i18n (giá trị đầu là text tiếng Anh chưa dịch, bị ghi đè âm thầm).
- Dọn dead code: `createCompanion`, `handleRegenerate`, các DOM ref không dùng (`historyPanel`, `historySearchInput`, `clearAllHistoryBtn`, `MAX_ATTACH_BYTES`).

## [0.2.0]

- Agent loop streaming SSE với tool calling (jinja/XML parsing), iteration cap,
  fallback tự retry không-tool khi llama-server trả 500.
- Bộ tool: web_search, calculator (AST), code_interpreter (sandbox), url_reader
  (SSRF filter), list_files/read_file, create_file/docx/xlsx, convert_to_markdown.
- MCP client (stdio JSON-RPC) nạp tool ngoài qua `mcp.json`.
- Companions & Projects (knowledge nhúng vào system prompt theo token budget).
- Persistence PostgreSQL + IndexedDB offline fallback; upload extract/to-markdown;
  context meter, message search, prompt library, regenerate variants.

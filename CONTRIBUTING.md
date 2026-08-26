# Contributing to Bobigo AI Studio

Cảm ơn bạn muốn đóng góp! Dự án là ứng dụng local-first nên ưu tiên **đơn giản, an toàn và chạy được offline**.

## Setup nhanh

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # hoặc requirements.lock.txt để khớp CI
./scripts/fetch_vendor.sh                    # vendor assets frontend (nếu chưa có trong repo)
```

Không cần Docker để chạy test — app và test suite đều boot được khi PostgreSQL đang tắt.

## Quy tắc làm việc

1. **Nhánh + PR:** tạo branch từ `main`, giữ PR nhỏ và tập trung một chủ đề.
2. **Test:** mọi bug-fix cần kèm regression test; feature mới cần unit test.
   ```bash
   .venv/bin/pytest -v
   ```
3. **Lint/format:** code Python phải pass `ruff check .` (config trong `pyproject.toml`).
   ```bash
   .venv/bin/ruff check --fix .
   .venv/bin/ruff format .
   ```
   Khuyến nghị cài pre-commit để tự động hoá:
   ```bash
   .venv/bin/pip install pre-commit && .venv/bin/pre-commit install
   ```
4. **Frontend:** vanilla JS ES modules, không thêm build step hay dependency mới
   mà không thảo luận trước. Mọi thư viện phải self-host trong `web/vendor/`
   (thêm vào `scripts/fetch_vendor.sh`). Output của model luôn đi qua DOMPurify.
5. **Security:** tuyệt đối không bỏ qua các guard sẵn có (SSRF filter, sandbox
   AST/import allowlist, workspace path guard). Thay đổi ở vùng này bắt buộc
   kèm test chứng minh guard vẫn hoạt động.
6. **Commit message:** kiểu imperative ngắn gọn, vd `fix(agent): retry without tools on HTTP 500`.

## Quy ước API

- **Error shape:** mọi endpoint trả lỗi theo `{ "error": "<thông điệp hiển thị được>" }` với HTTP status phù hợp (400/413/502/503). Frontend đọc `data.error` — không đổi shape này trừ khi có thảo luận (breaking change).
- **Persistence:** bulk `PUT /api/sessions|companions|projects` là reconcile chính; `POST /api/sessions/{id}/messages` & `DELETE /api/sessions/{id}` là đường tăng dần (client dùng song song như durability insurance).
- **i18n:** thông điệp lỗi backend mặc định tiếng Việt; frontend chỉ hiển thị nguyên văn.


## Cấu trúc nhanh xem ở đâu

- Kiến trúc tổng thể & sơ đồ: `README.md` → mục *Kiến trúc*.
- Lịch sử thay đổi: `CHANGELOG.md`.

## Báo lỗi

Mở issue kèm: bước tái hiện, log backend (`BOBIGO_LOG_LEVEL=DEBUG`), phiên bản
OS/model GGUF đang dùng.

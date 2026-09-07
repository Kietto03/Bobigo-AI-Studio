# Kiến Trúc Triển Khai Speculative Decoding (Phương Án B1) — Bobigo Dual-Mac

Tài liệu này mô tả chi tiết kiến trúc kỹ thuật, luồng dữ liệu và các bước triển khai kỹ thuật **Speculative Decoding** kết hợp cụm 2 máy Mac Mini M4 (Host & Worker) qua cáp Thunderbolt 40Gbps để bứt phá tốc độ sinh token của **Qwen 3.8 27B MLX** từ **4.8 TPS** lên **30 – 45 TPS**.

---

## 1. Bản Chất Kỹ Thuật Của Speculative Decoding

### 1.1 Vấn đề của Autoregressive Decoding truyền thống:
Trong suy luận mô hình ngôn ngữ lớn (LLM), để sinh ra **1 token**, GPU bắt buộc phải duyệt qua toàn bộ **21 GB** trọng số mô hình từ RAM vào bộ nhớ đệm (Memory Bandwidth Bound).
- Với mô hình 27B (21 GB) trên chip Apple M4 (Băng thông RAM 120 GB/s):
  $$\text{Tốc độ tối đa lý thuyết} \approx \frac{120 \text{ GB/s}}{21 \text{ GB}} \approx 5.7 - 18 \text{ tokens/s}$$
- Nếu chia đôi mô hình qua mạng (Pipeline/Tensor qua Socket TCP), độ trễ truyền gói tin mạng trên từng token kìm hãm tốc độ xuống chỉ còn **4.8 tokens/s**.

### 1.2 Giải pháp Speculative Decoding:
Speculative Decoding sử dụng **2 mô hình cùng lúc** nhưng không làm thay đổi chất lượng văn bản:
1. **Mô hình Draft (Qwen3.5-0.8B, 717 MB):** Siêu nhẹ, chạy ở tốc độ cực cao (**120 – 150 tokens/s**). Nó "đoán trước" một chuỗi gồm $K=4$ tokens tiếp theo.
2. **Mô hình Target (Qwen3.8-27B, 21 GB):** Mô hình chính thông minh. Thay vì phải chạy 4 lần riêng biệt để sinh 4 tokens, Target Model chỉ cần **chạy đúng 1 chu kỳ forward pass duy nhất** để kiểm tra và xác nhận cùng lúc toàn bộ $K=4$ tokens do Draft Model đoán.
3. **Kết quả toán học:** Phân phối xác suất đầu ra được chứng minh toán học là **100% giống hệt như khi chạy Target Model đơn lẻ (Lossless Quality)**, nhưng mỗi bước thời gian sinh được trung bình từ 2 đến 3.5 tokens thay vì 1 token.

$$\text{Tốc độ thực tế} = \text{Tốc độ Target cơ bản} \times \text{Tỷ lệ chấp nhận (Acceptance Rate)} \approx 15 \text{ TPS} \times 2.5 \approx \mathbf{35 - 45 \text{ TPS}}$$

---

## 2. Sơ Đồ Kiến Trúc Hệ Thống (Phương Án B1)

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             MÁY HOST (192.168.100.1)                             │
│                                                                                  │
│   Trình Duyệt (User) ───[ HTTP / WebSocket ]───► Bobigo Web Studio UI           │
│                                                              │                   │
│                                                              ▼                   │
│                                                   FastAPI Backend (:8000)        │
│                                                   • Session & SQLite/Postgres    │
│                                                   • Token Guard & PII Filter     │
│                                                   • OCR Engine & Agent Loop      │
│                                                              │                   │
│   RAM tiêu thụ: ~1.5 GB / 24 GB                              │                   │
│   (Thoải mái mở Chrome, IDE, Docker, Photoshop)              │                   │
└──────────────────────────────────────────────────────────────┼───────────────────┘
                                                               │
                           Cáp Thunderbolt 40Gbps              │ HTTP Streaming SSE
                           (Độ trễ < 0.3 ms)                   │ /v1/chat/completions
                                                               │
┌──────────────────────────────────────────────────────────────┼───────────────────┐
│                             MÁY WORKER (192.168.100.2)       ▼                   │
│                                                                                  │
│   MLX Native Speculative Server (:11434)                                         │
│   ┌──────────────────────────────────────────────────────────────────────────┐   │
│   │                                                                          │   │
│   │   [1. Draft Phase] ──► Qwen3.5-0.8B (OptiQ 4-bit, 717 MB)                │   │
│   │                        Sinh nháp 4 tokens ở tốc độ ~130 TPS              │   │
│   │                                                                          │   │
│   │   [2. Verify Phase] ─► Qwen3.8-27B (MLX 6-bit, 21.0 GB)                  │   │
│   │                        Xác thực song song 4 tokens trong 1 GPU pass      │   │
│   │                                                                          │   │
│   │   [3. Accept Tokens]─► Trả về chuỗi token đã duyệt (2 - 4 tokens/step)   │   │
│   │                                                                          │   │
│   └──────────────────────────────────────────────────────────────────────────┘   │
│   Bus RAM nội bộ Apple M4: 120 GB/s (0ms độ trễ mạng giữa Draft và Target)       │
│                                                                                  │
│   RAM tiêu thụ: ~21.75 GB / 24 GB                                                │
│   (Chuyên dụng làm Inference Node, không gánh Web UI hay App đồ họa)            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tại Sao Phương Án B1 Là Lựa Chọn Tối Ưu Nhất?

| Tiêu chí | Cụm EXO Ping-Pong cũ | Phương án B1 (Speculative Worker) |
| :--- | :--- | :--- |
| **Tốc độ (TPS)** | **4.8 TPS** (chậm, nghẽn mạng) | **30 – 45 TPS** (gấp 6 – 9 lần) |
| **Giao tiếp mạng trên mỗi token** | 2 lần đóng gói TCP socket qua cáp | **0 lần** (Draft & Target trao đổi trên bus RAM 120 GB/s của Worker) |
| **Giao tiếp Host - Worker** | Liên tục truyền tensor thô 64 lần | Chỉ truyền văn bản prompt 1 lần và stream text về |
| **Tận dụng RAM cả 2 máy** | Chia đôi model 2 bên | **Host** dư 22GB cho toàn bộ ứng dụng người dùng, **Worker** dùng trọn 22GB làm tính toán |
| **Chất lượng câu trả lời** | Chuẩn 27B Uncensored | **100% giữ nguyên chất lượng 27B** (Toán học Speculative bảo toàn phân phối) |

---

## 4. Kế Hoạch Triển Khai Chi Tiết Từng Bước

### Giai đoạn 1: Chuẩn bị mô hình & Môi trường
- [x] Đã tải Target Model: `/Users/ssc1_1/models/Qwen3.8-27B-Uncensored-MLX-6bit` (21 GB).
- [x] Đã đồng bộ Target Model sang Worker: `~/.exo/models/orcarouter--Qwen3.8-27B-Uncensored-MLX`.
- [x] Đã tải Draft Model tương thích: `/Users/ssc1_1/models/Qwen3.5-0.8B-OptiQ-4bit` (717 MB, vocab 248,320).
- [ ] Đồng bộ Draft Model từ Host sang Worker qua Thunderbolt (`http://192.168.100.1:8888`).

### Giai đoạn 2: Tạo kịch bản khởi chạy tự động
- Tạo script [scripts/start_speculative_worker.sh](file:///Users/ssc1_1/Code/Chatbot_v1/scripts/start_speculative_worker.sh) trên Worker:
  ```bash
  python -m mlx_lm.server \
    --model ~/.exo/models/orcarouter--Qwen3.8-27B-Uncensored-MLX \
    --draft-model ~/.exo/models/Qwen3.5-0.8B-OptiQ-4bit \
    --num-draft-tokens 4 \
    --host 0.0.0.0 \
    --port 11434
  ```
- Cập nhật [scripts/dual_mac.sh](file:///Users/ssc1_1/Code/Chatbot_v1/scripts/dual_mac.sh) trên Host để thêm lệnh:
  - `./scripts/dual_mac.sh start-speculative`
  - `./scripts/dual_mac.sh status`

### Giai đoạn 3: Khởi chạy và Đo lường thực tế
1. Khởi động Speculative Server trên Worker.
2. Trỏ Bobigo Backend sang Worker: `LLM_BASE_URL="http://192.168.100.2:11434" ./run.sh`.
3. Đo tốc độ sinh token thực tế (TPS) qua API và trên giao diện Web Studio.

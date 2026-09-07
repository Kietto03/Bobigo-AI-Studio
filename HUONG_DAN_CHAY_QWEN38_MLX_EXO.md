# Hướng Dẫn Tích Hợp & Chạy Qwen 3.8 MLX (6-bit) Cụm Dual-Mac Bằng EXO

Tài liệu hướng dẫn chi tiết cách vận hành mô hình **`orcarouter/Qwen3.8-27B-Uncensored-MLX` (6-bit, 21GB)** trên cụm 2 máy Mac Mini M4 (Host & Worker) kết nối cáp Thunderbolt 40Gbps thông qua framework phân tán **EXO (Apple MLX backend)**.

---

## 1. Cơ Chế Phân Bổ RAM & Băng Thông Cụm Dual-Mac

```text
Host Mac Mini M4 (24GB RAM)               Worker Mac Mini M4 (24GB RAM)
IP: 192.168.100.1                        IP: 192.168.100.2
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ • Bobigo Web + FastAPI (:8000)│        │ • EXO Node (MLX Backend)      │
│ • EXO Master (:52415)         │◄──────►│ • Gánh Shard 2: ~10.5 GB VRAM │
│ • Gánh Shard 1: ~10.5 GB VRAM │ 40Gbps │ • Không chạy Web UI           │
│ • Dư dả ~13.5 GB cho macOS/App│        │ • Dư dả ~13.5 GB RAM          │
└───────────────────────────────┘        └───────────────────────────────┘
```

- **Tổng RAM gộp:** 48GB Unified Memory.
- **Model 21GB:** Được chia làm 2 phần (Tensor/Pipeline Shards), mỗi máy gánh đúng **~10.5 GB VRAM**.
- **Không lo đầy RAM:** Cả máy Host và máy Worker đều còn trống hơn **13 GB RAM**, chấm dứt hoàn toàn tình trạng treo máy/swap SSD.

---

## 2. Chuẩn Bị Trên Máy Worker (`192.168.100.2`)

Chạy các bước sau trên Terminal của máy Worker (hoặc qua SSH):

### Bước 2.1: Cài đặt EXO trên Worker
```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask exo
```

### Bước 2.2: Khởi chạy Worker Node
Trên máy Worker, chạy script đã chuẩn bị sẵn:
```bash
cd ~/Code/Chatbot_v1
./scripts/start_exo_worker.sh
```
*(Node Worker sẽ tự động kết nối vào Master Host qua cổng Thunderbolt `192.168.100.1`).*

---

## 3. Khởi Chạy Trên Máy Host (`192.168.100.1`)

Trên máy Host, bạn chỉ cần dùng đúng 1 lệnh quản lý `dual_mac.sh`:

### Bước 3.1: Khởi động cụm EXO MLX
```bash
./scripts/dual_mac.sh start-exo
```
Lệnh này sẽ:
1. Tự động tắt `llama-server` để giải phóng 16GB RAM cũ.
2. Nạp model `orcarouter/Qwen3.8-27B-Uncensored-MLX` vào cụm.
3. Mở API chuẩn OpenAI tại cổng `52415`.

### Bước 3.2: Kiểm tra trạng thái cụm
```bash
./scripts/dual_mac.sh status
```
Hoặc mở trình duyệt truy cập Dashboard trực quan của EXO:
👉 **`http://localhost:52415`** (hiển thị topology 2 máy Mac và tiến độ sinh token).

---

## 4. Chuyển Đổi Linh Hoạt Giữa Qwen 35B và Qwen 3.8 MLX

Bạn có thể đổi qua lại giữa 2 mô hình bất kỳ lúc nào mà không xung đột:

| Muốn chuyển sang... | Lệnh thực hiện |
| :--- | :--- |
| **Qwen 3.8 (MLX 27B 6-bit)** | `./scripts/dual_mac.sh start-exo` |
| **Qwen 35B (GGUF llama.cpp RPC)** | `./scripts/dual_mac.sh stop-exo && ./scripts/dual_mac.sh connect` |
| **Kiểm tra trạng thái toàn cụm** | `./scripts/dual_mac.sh status` |

---

## 5. Kết Nối Bobigo Studio Với EXO

Khởi chạy backend Bobigo trỏ vào EXO API:
```bash
LLM_BASE_URL="http://127.0.0.1:52415" DEFAULT_MODEL="orcarouter/Qwen3.8-27B-Uncensored-MLX" ./run.sh
```
Giao diện Bobigo Web Studio (`http://127.0.0.1:8000`) sẽ lập tức nhận diện mô hình Qwen 3.8 MLX và sẵn sàng trò chuyện!

# Sổ Tay Hướng Dẫn Kết Nối Cụm Dual-Mac (Bobigo AI Studio)

> **Mục tiêu:** Gộp sức mạnh Metal GPU và Unified Memory của 2 máy Mac (Host & Worker) qua cáp Thunderbolt để chạy mô hình AI lớn (Qwen 35B) ổn định 24/7, đồng thời cung cấp API Key chuẩn OpenAI để chia sẻ cho mọi người cùng dùng.

---

## 1. Yêu cầu phần cứng & Chuẩn bị

| Thành phần | Yêu cầu kỹ thuật | Ghi chú |
| :--- | :--- | :--- |
| **Máy chính (Host / Master)** | Mac Mini / Mac Studio (chạy Bobigo, Web, DB) | Đảm bảo bật Docker & Python backend |
| **Máy phụ (Worker / Remote GPU)** | Mac Mini / MacBook (cho mượn GPU) | **Không** cần cài Bobigo hay Database |
| **Cáp kết nối** | **Cáp Thunderbolt 3 hoặc 4 (40 Gbps)** | Phải có logo tia sét ⚡ *(Không dùng cáp sạc USB-C)* |

---

## 2. Cấu hình mạng Thunderbolt (IP tĩnh giữa 2 máy)

Cắm cáp Thunderbolt trực tiếp giữa cổng Thunderbolt của 2 máy.

### Trên Máy Host (Máy chính)
1. Vào **Cài đặt hệ thống (System Settings)** ➔ **Mạng (Network)**.
2. Chọn **Thunderbolt Bridge** (hoặc cổng Thunderbolt tương ứng, ví dụ `EXO Thunderbolt 1`):
   - **Định cấu hình IPv4 (Configure IPv4):** `Thủ công (Manually)`
   - **Địa chỉ IP (IP Address):** `192.168.100.1`
   - **Mặt nạ mạng con (Subnet Mask):** `255.255.255.0`
   - **Bộ định tuyến (Router):** Để trống ➔ Nhấn **Áp dụng (Apply)**.

### Trên Máy Worker (Máy phụ)
1. Vào **Cài đặt hệ thống (System Settings)** ➔ **Mạng (Network)** ➔ **Thunderbolt Bridge**:
   - **Định cấu hình IPv4 (Configure IPv4):** `Thủ công (Manually)`
   - **Địa chỉ IP (IP Address):** `192.168.100.2`
   - **Mặt nạ mạng con (Subnet Mask):** `255.255.255.0`
   - **Bộ định tuyến (Router):** Để trống ➔ Nhấn **Áp dụng (Apply)**.

### Kiểm tra đường truyền (Từ máy Host)
Mở Terminal trên máy Host và gõ:
```bash
ping -c 3 192.168.100.2
```
> **Đạt chuẩn:** Thời gian phản hồi `time=0.4 ~ 0.7 ms` (0% packet loss).

---

## 3. Thiết lập trên Máy Worker (Chạy Remote Metal GPU)

### Bước 1: Build llama.cpp có hỗ trợ RPC (Chỉ làm 1 lần)
Mở Terminal trên máy Worker:
```bash
xcode-select --install       # Cài công cụ Xcode (nếu chưa có)
brew install cmake git       # Cài cmake

git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_RPC=ON
cmake --build build --config Release -j
```

### Bước 2: Khởi chạy RPC Server (Chống Sleep 24/7)
Trên Terminal máy Worker, chạy lệnh vòng lặp tự hồi phục kết hợp `caffeinate`:
```bash
cd llama.cpp
while true; do caffeinate -dimsu ./build/bin/ggml-rpc-server -H 0.0.0.0 -p 50052 || true; sleep 2; done
```
- Dùng `-H 0.0.0.0` để lắng nghe mọi kết nối qua mạng Thunderbolt.
- `caffeinate -dimsu` ngăn máy tự động tắt màn hình, ngủ ngắt quãng hay ngắt điện cổng Thunderbolt.

---

## 4. Thiết lập trên Máy Host (Khởi chạy Bobigo)

### Bước 1: Bật Database & Web App
```bash
# 1. Bật Docker PostgreSQL container
docker start bobigo-postgres

# 2. Khởi chạy Web Server Bobigo
.venv/bin/python server.py
```

### Bước 2: Khởi chạy LLM Backend (Tự động nhận 2 GPU)
```bash
bash scripts/start_backend.sh
```
> Khi khởi động, terminal sẽ báo:
> `🔗 Kết nối RPC Worker thành công: 192.168.100.2:50052 (Đang chạy Dual-Mac GPU Cluster)`

---

## 5. Theo dõi trực quan qua Dashboard Quản Trị

Mở trình duyệt trên máy Host vào: **`http://localhost:8000/admin.html`**
- Đăng nhập: `admin` / `admin123`
- **Tab Giám sát (Monitoring):**
  - **Host (Master):** Hiển thị RAM, Uptime, GPU Local.
  - **Đường truyền:** Hiển thị Ping thời gian thực qua cáp Thunderbolt (`<1 ms`).
  - **Worker (Remote GPU):** Hiển thị trạng thái **ONLINE** (màu xanh lá) và cổng `50052`.
  - **LLM Engine:** Hiển thị mô hình `Qwen 35B` đang nạp phân tán trên cả 2 máy.

---

## 6. Chia sẻ cho mọi người cùng dùng (OpenAI Compatible API)

Hệ thống đã tích hợp sẵn API Key để người khác trong cùng mạng Wi-Fi/LAN có thể kết nối thử nghiệm:

- **Địa chỉ máy chủ (Base URL):** `http://<IP_LAN_MAY_HOST>:8000/v1`  
  *(Ví dụ trong mạng hiện tại: `http://10.1.68.212:8000/v1`)*
- **API Key dùng thử:** `sk-bobigo-trial-2026`

### Ví dụ 1: Gọi bằng cURL (Terminal)
```bash
curl http://10.1.68.212:8000/v1/chat/completions \
  -H "Authorization: Bearer sk-bobigo-trial-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Xin chào! Bạn đang chạy trên mấy máy Mac?"}],
    "max_tokens": 100
  }'
```

### Ví dụ 2: Dùng thư viện Python `openai`
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://10.1.68.212:8000/v1",
    api_key="sk-bobigo-trial-2026",
)

response = client.chat.completions.create(
    model="qwen35b-uncensored",
    messages=[{"role": "user", "content": "Chào Bobigo!"}],
)

print(response.choices[0].message.content)
```

---

## 7. Xử lý sự cố thường gặp (Troubleshooting)

| Hiện tượng | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| **Ping `192.168.100.2` Request timeout** | Cáp bị lỏng, cáp không phải Thunderbolt, hoặc máy Worker đang Sleep | Đánh thức máy Worker, kiểm tra đúng cáp Thunderbolt có ký hiệu ⚡. |
| **Worker báo `Failed to create server socket`** | Trùng cổng `50052` hoặc bind sai IP | Chạy `killall ggml-rpc-server` rồi chạy lại với cờ `-H 0.0.0.0 -p 50052`. |
| **Đứt kết nối sau 1 thời gian không dùng** | Máy Worker tự ngủ (Sleep) khi không có người gõ phím | Luôn bọc lệnh chạy bằng `caffeinate -dimsu` hoặc vào System Settings tắt tự động ngủ. |
| **Host báo `Single-Mac Standalone`** | Worker chưa bật lệnh RPC trước khi Host nạp model | Chạy lệnh RPC trên Worker trước, sau đó chạy lại `bash scripts/start_backend.sh` trên Host. |

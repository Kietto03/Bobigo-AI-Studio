# Báo cáo Trạng thái Hệ thống & Hướng dẫn Cấu hình Máy Worker

> **Cập nhật:** 28/08/2026  
> **Kiến trúc:** Cụm phân tán Dual-Mac Apple Silicon Metal GPU qua giao thức `llama.cpp RPC` & cáp Thunderbolt 40 Gbps.

---

## 1. Tình trạng Hệ thống Hiện tại

| Thành phần | Máy | Trạng thái | Chi tiết kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Máy chính (Host / Master)** | Mac Mini Host | **Hoạt động (ONLINE)** | IP: `192.168.100.1` · RAM: 24GB Unified Memory · Metal 3 |
| **Giao diện Web & API** | Mac Mini Host | **Hoạt động (ONLINE)** | Port `8000` (FastAPI + Web Studio + Admin Console) |
| **Cơ sở dữ liệu** | Mac Mini Host | **Hoạt động (ONLINE)** | PostgreSQL Docker Container (`bobigo-postgres` trên port `5432`) |
| **LLM Engine** | Mac Mini Host | **Hoạt động (Single Mode)** | Đang chạy Qwen 35B (~34.6B tham số, `Q4_K_M`) trên 1 máy local |
| **Máy phụ (Worker / Remote GPU)** | Mac Mini Worker | **Chờ kích hoạt (OFFLINE)** | IP đích: `192.168.100.2` · Cổng RPC: `50052` (Chưa có phản hồi ping) |

---

## 2. Nhiệm vụ Máy Worker Cần Thực Hiện

Máy Worker chỉ đóng vai trò **"cho mượn GPU Metal"**, không cần cài đặt Web, Python backend hay Database. Bạn chỉ cần thực hiện 3 bước sau trên máy Worker:

### Bước 1: Cấu hình Mạng Cáp Thunderbolt trên Máy Worker
1. Cắm cáp Thunderbolt nối trực tiếp giữa cổng Thunderbolt của **Máy Host** và **Máy Worker**.
2. Trên máy **Worker**, mở **Cài đặt hệ thống (System Settings)** ➔ **Mạng (Network)**.
3. Chọn mục **Thunderbolt Bridge** (hoặc **Cầu nối Thunderbolt**):
   - **Định cấu hình IPv4 (Configure IPv4):** Chọn **Thủ công (Manually)**
   - **Địa chỉ IP (IP Address):** `192.168.100.2`
   - **Mặt nạ mạng con (Subnet Mask):** `255.255.255.0`
   - **Bộ định tuyến (Router):** Để trống
   - Nhấn **Áp dụng (Apply)**.

---

### Bước 2: Chuẩn bị llama.cpp RPC trên Máy Worker *(Bỏ qua nếu đã build)*
Nếu trên máy Worker chưa build `llama.cpp` có hỗ trợ RPC, mở Terminal chạy:

```bash
# 1. Cài đặt công cụ build (nếu chưa có)
xcode-select --install
brew install cmake git

# 2. Clone mã nguồn llama.cpp
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp

# 3. Biên dịch với cờ RPC và Metal GPU
cmake -B build -DGGML_RPC=ON
cmake --build build --config Release -j
```

---

### Bước 3: Khởi chạy RPC Server có Caffeinate (Chống Sleep 24/7)
Mở Terminal trên máy Worker và chạy lệnh sau:

```bash
cd llama.cpp
caffeinate -dimsu ./build/bin/ggml-rpc-server -H 0.0.0.0 -p 50052
```

*(Hoặc chạy script tự động giữ kết nối liên tục không bao giờ tắt):*
```bash
cd llama.cpp
while true; do
  caffeinate -dimsu ./build/bin/ggml-rpc-server -H 0.0.0.0 -p 50052 || true
  sleep 2
done
```

> **Giải thích cờ `caffeinate -dimsu`:**
> - `-d`: Ngăn tắt màn hình.
> - `-i`: Ngăn hệ thống rơi vào trạng thái Idle Sleep.
> - `-m`: Ngăn ổ cứng và bus I/O (Thunderbolt) ngủ.
> - `-s`: Giữ máy luôn chạy liên tục khi cắm nguồn điện.
> - `-u`: Khai báo user luôn hoạt động để duy trì kết nối mạng tốc độ tối đa.

---

## 3. Cách Kiểm tra Sau Khi Bật Máy Worker

Sau khi máy Worker đã chạy lệnh ở Bước 3:

1. **Kiểm tra trực quan trên Dashboard Quản trị:**
   - Mở trình duyệt trên máy Host vào: **`http://localhost:8000/admin.html`**
   - Vào tab **Giám sát (Monitoring)**.
   - Trạng thái **Máy phụ (Worker)** sẽ tự động chuyển sang **ONLINE** (màu xanh lá) và hiển thị độ trễ Ping `<1ms`.

2. **Kích hoạt chạy mô hình trên Cụm 2 GPU:**
   - Trên máy Host, chỉ cần chạy lại backend để tự động chia tải model sang cả 2 máy:
     ```bash
     bash scripts/start_backend.sh
     ```
   - Log khởi động sẽ hiển thị 2 thiết bị Metal GPU (1 Local + 1 Remote RPC) và tự động chia đều các layer của model trên RAM của cả 2 máy.

---

## 4. Xử lý Sự cố Thường gặp (Troubleshooting)

- **Ping không thông (`Request timeout`):**
  - Kiểm tra xem cáp có phải là **cáp Thunderbolt thật** (có biểu tượng tia sét ⚡) hay chỉ là cáp sạc Type-C thông thường. Cáp sạc thông thường sẽ không tạo được kết nối Thunderbolt Bridge 40Gbps.
  - Đảm bảo IP trên máy Host là `192.168.100.1` và máy Worker là `192.168.100.2`.
- **Tường lửa (macOS Firewall) chặn cổng:**
  - Trên máy Worker: Vào `System Settings > Network > Firewall` và tắt tạm thời hoặc cấp phép cho binary `ggml-rpc-server`.
- **Máy Worker bị Sleep (Ngủ):**
  - Vào `System Settings > Energy Saver` (hoặc `Lock Screen`) trên máy Worker và tắt chế độ tự động ngủ để tránh đứt kết nối giữa chừng.

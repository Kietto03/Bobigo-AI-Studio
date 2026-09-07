# Hướng dẫn nối 2 Mac Mini M4 chạy Bobigo AI Studio (llama.cpp RPC backend)

Project tham khảo: [Bobigo-AI-Studio](https://github.com/Kietto03/Bobigo-AI-Studio) — dùng `llama-server` (llama.cpp, Metal GPU, `--jinja`) làm backend LLM, không phải MLX.

## Vì sao chọn llama.cpp RPC thay vì EXO

Bobigo được xây cứng quanh `llama-server` (GGUF, Metal, `--jinja` để tool-calling qua `backend/agent/parse.py`). EXO chạy trên backend MLX riêng — nếu chuyển sang EXO, phải bỏ GGUF, đổi qua model MLX-quant, và có rủi ro thật: cách EXO áp dụng chat template / xuất tool-call token có thể không khớp với format mà `parse.py` của Bobigo đang bóc tách, khiến tool-calling (`web_search`, `calculator`, `code_interpreter`...) gãy.

**llama.cpp có sẵn RPC backend riêng** (`rpc-server` + cờ `--rpc` trên `llama-server`) cho phép phân tán layer của model GGUF qua nhiều máy, giữ nguyên toàn bộ format và API — không cần đổi code Bobigo, chỉ sửa 1 dòng lệnh khởi chạy.

## Kiểm tra trước khi làm

`--rpc` chỉ thực sự đáng làm nếu model (vd. Qwen3.6 4-bit ~20GB) **không vừa RAM của 1 Mac Mini**. Nếu 1 máy đã đủ RAM chạy mượt, ghép RPC qua mạng thường (TCP, không phải RDMA thật) sẽ làm **chậm hơn** vì thêm round-trip mạng mỗi lớp.

Check RAM mỗi máy:
```bash
system_profiler SPHardwareDataType | grep Memory
```
- Nếu tổng RAM cần cho model > 1 máy → làm theo hướng dẫn dưới.
- Nếu không → chạy đơn máy sẽ nhanh hơn, không cần ghép.

## Vai trò 2 máy

- **Mac Mini chính (Host)**: máy đang chạy Bobigo đầy đủ (Postgres, FastAPI, web) — giữ nguyên.
- **Mac Mini phụ (Worker)**: chỉ cần cài llama.cpp, không cần cài Bobigo/Postgres — chỉ "cho mượn" GPU Metal.

## Bước 1 — Nối Thunderbolt Bridge

Cắm cáp Thunderbolt trực tiếp giữa 2 máy. Trên **cả 2 máy**:

1. `System Settings > Network` → sẽ thấy interface mới tên **Thunderbolt Bridge**.
2. Click vào, chọn `Configure IPv4: Manually`.
3. Đặt IP tĩnh không trùng nhau:
   - Máy chính: `192.168.100.1` / Subnet `255.255.255.0`
   - Máy phụ: `192.168.100.2` / Subnet `255.255.255.0`
4. Test: từ máy chính chạy `ping 192.168.100.2`.

Dùng Thunderbolt Bridge thay vì Wi-Fi/router để giảm độ trễ tối đa.

## Bước 2 — Build llama.cpp có RPC trên máy phụ

```bash
xcode-select --install   # nếu chưa có
brew install cmake

git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DGGML_RPC=ON
cmake --build build --config Release -j
```
Metal tự động bật trên Apple Silicon, không cần cờ riêng.

## Bước 3 — Chạy rpc-server trên máy phụ

```bash
./build/bin/rpc-server -H 192.168.100.2 -p 50052
```

⚠️ **Bind đúng IP Thunderbolt (`192.168.100.2`), không bind `0.0.0.0`.** Tài liệu chính thức của llama.cpp cảnh báo RPC backend còn ở giai đoạn proof-of-concept, không có xác thực/mã hóa — ai kết nối được vào cổng này đều điều khiển được GPU máy đó. Bind đúng IP Thunderbolt giới hạn nó chỉ nghe từ sợi cáp trực tiếp.

Nếu macOS Firewall đang bật: `System Settings > Network > Firewall > Options` → cho phép kết nối đến.

## Bước 4 — Rebuild llama.cpp có RPC client trên máy chính

Máy chính hiện chạy `llama-server` bản build sẵn không có RPC client — build lại y hệt Bước 2 trên máy chính, hoặc thay binary `llama-server` hiện có bằng bản mới build.

## Bước 5 — Sửa script khởi động của Bobigo

Mở `scripts/start_backend.sh`, tìm dòng gọi `llama-server`, thêm cờ `--rpc`:

```bash
llama-server \
  -m "$MODEL_PATH" \
  --jinja \
  -ngl 99 \
  --rpc 192.168.100.2:50052 \
  -c 8192 \
  --host 127.0.0.1 --port 11434
```

`-ngl 99` giờ nghĩa là offload toàn bộ layer; llama.cpp tự chia layer giữa GPU local (máy chính) và GPU remote qua RPC (máy phụ) theo VRAM còn trống mỗi bên.

## Bước 6 — Chạy và kiểm tra

```bash
./run.sh
```

Xem log lúc `llama-server` khởi động — nếu thấy connect thành công tới `192.168.100.2:50052` và liệt kê thêm 1 backend Metal thứ 2, cluster đã ghép đúng.

Kiểm tra thêm:
```bash
curl http://127.0.0.1:11434/props
```
để xem tổng context/memory phản ánh cả 2 máy.

## Về việc "cho mọi người cùng dùng"

Đây là vấn đề khác, không liên quan đến việc ghép máy GPU.

Theo README, Bobigo hiện chỉ bind loopback (`127.0.0.1`) cho cả web server lẫn Postgres, không có hệ thống tài khoản/đăng nhập — dữ liệu (sessions, companions, projects) nằm chung 1 Postgres instance.

- Đổi `HOST=0.0.0.0` để mở port 8000 ra LAN là đủ về mặt kỹ thuật để nhiều người truy cập — nhưng **mọi người sẽ share chung 1 kho chat/companion/project**, không có ranh giới riêng tư giữa các user.
- Nếu cần dữ liệu riêng biệt từng người dùng → cần thêm auth + multi-tenant DB schema, đây là một khoản dev riêng, không phải chuyện network/GPU.

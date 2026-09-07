# Bobigo AI Studio — Kiến trúc và hướng dẫn kết nối Dual-Mac ổn định

Tài liệu này mô tả mô hình một máy **Host** chạy Bobigo và một máy **Worker** chia sẻ GPU Metal qua `llama.cpp RPC`.

## 1. Kiến trúc

```text
Browser
   │ HTTP / SSE
   ▼
Host Mac: FastAPI + Web UI :8000
   │ HTTP OpenAI-compatible
   ▼
llama-server :11434 (GPU Metal local)
   │ llama.cpp RPC / TCP
   │ 192.168.100.2:50052
   ▼
Worker Mac: ggml-rpc-server (GPU Metal remote)

Host Thunderbolt Bridge:   192.168.100.1/24
Worker Thunderbolt Bridge: 192.168.100.2/24
```

| Thành phần | Host | Worker |
|---|---:|---:|
| FastAPI/Web UI | Có | Không |
| PostgreSQL | Có | Không |
| `llama-server` | Có | Không |
| `ggml-rpc-server`/`rpc-server` | Không | Có |
| RPC | Kết nối tới `192.168.100.2:50052` | Listen `192.168.100.2:50052` |

Worker chỉ cung cấp backend RPC/GPU; không cần cài Bobigo hoặc PostgreSQL.

## 2. Nguyên tắc kết nối ổn định và an toàn

1. Dùng cáp Thunderbolt 3/4 thật, không dùng cáp USB-C chỉ để sạc.
2. Dùng IP tĩnh trên **Thunderbolt Bridge**: Host `192.168.100.1`, Worker `192.168.100.2`, subnet `255.255.255.0`.
3. Worker phải chạy RPC trước khi Host nạp model.
4. Không bind RPC vào `0.0.0.0` nếu không cần. RPC llama.cpp không có authentication/encryption đầy đủ.
5. Chỉ cho phép Host truy cập `192.168.100.2:50052`.
6. TCP port mở chưa chứng minh model đã dùng Worker; phải kiểm tra process Host có `--rpc`.
7. Nếu Worker khởi động sau Host, cần restart `llama-server` sau khi Worker online.

## 3. Cấu hình Thunderbolt Bridge

Trong `System Settings → Network → Thunderbolt Bridge`, đặt:

### Host

```text
Configure IPv4: Manually
IP Address:     192.168.100.1
Subnet Mask:    255.255.255.0
Router:         để trống
```

### Worker

```text
Configure IPv4: Manually
IP Address:     192.168.100.2
Subnet Mask:    255.255.255.0
Router:         để trống
```

Kiểm tra hai chiều:

```bash
# Trên Host
ping -c 3 192.168.100.2

# Trên Worker
ping -c 3 192.168.100.1
```

Nếu ping không được, chưa tiếp tục cấu hình RPC. Kiểm tra cáp, đúng interface, IP không trùng và firewall.

## 4. Instruction cho Worker Mac

Các lệnh trong phần này chạy trên Worker.

### 4.1. Build llama.cpp có RPC

```bash
xcode-select --install
brew install cmake git
cd "$HOME/llama.cpp"
cmake -B build -DGGML_RPC=ON
cmake --build build --config Release -j
```

Kiểm tra binary:

```bash
ls -l "$HOME/llama.cpp/build/bin/ggml-rpc-server"
```

Một số phiên bản dùng tên `rpc-server`:

```bash
ls -l "$HOME/llama.cpp/build/bin/rpc-server"
```

Chỉ dùng binary tồn tại trên máy Worker.

### 4.2. Ngăn Worker tự ngủ

Worker nên cắm nguồn liên tục:

```bash
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a powernap 0
sudo pmset -a tcpkeepalive 1
sudo pmset -a autorestart 1
pmset -g custom
```

Khi chạy RPC, dùng `caffeinate -ims` để ngăn idle/system/disk sleep. Không cần dùng `-d` vì không cần giữ màn hình sáng.

### 4.3. Chạy thử RPC

Thay `<worker-user>` bằng username thật. Dùng `ggml-rpc-server` hoặc đổi thành `rpc-server` nếu đó là binary của bản build:

```bash
/usr/bin/caffeinate -ims \
  "/Users/<worker-user>/llama.cpp/build/bin/ggml-rpc-server" \
  -H 192.168.100.2 \
  -p 50052
```

Từ Host kiểm tra:

```bash
nc -z -G 1 192.168.100.2 50052
```

Dừng chạy thử bằng `Ctrl+C` trước khi cài tự động.

### 4.4. Tự khởi động và tự phục hồi bằng launchd

`launchd` tốt hơn việc giữ một Terminal với `while true`: nó tự chạy sau đăng nhập/reboot và tự restart khi RPC lỗi.

```bash
mkdir -p "$HOME/Library/Logs/Bobigo"
mkdir -p "$HOME/Library/LaunchAgents"
```

Tạo file:

```text
/Users/<worker-user>/Library/LaunchAgents/com.bobigo.rpc-worker.plist
```

Nội dung sau dùng binary `ggml-rpc-server`; nếu Worker dùng binary `rpc-server`, thay tên binary trong `ProgramArguments`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bobigo.rpc-worker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-ims</string>
        <string>/Users/&lt;worker-user&gt;/llama.cpp/build/bin/ggml-rpc-server</string>
        <string>-H</string>
        <string>192.168.100.2</string>
        <string>-p</string>
        <string>50052</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/&lt;worker-user&gt;/llama.cpp</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>/Users/&lt;worker-user&gt;/Library/Logs/Bobigo/rpc-worker.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/&lt;worker-user&gt;/Library/Logs/Bobigo/rpc-worker.error.log</string>
</dict>
</plist>
```

Thay `<worker-user>` bằng username thật, sau đó kiểm tra và nạp service:

```bash
plutil -lint "$HOME/Library/LaunchAgents/com.bobigo.rpc-worker.plist"

launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.bobigo.rpc-worker.plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.bobigo.rpc-worker.plist"
launchctl enable "gui/$(id -u)/com.bobigo.rpc-worker"
launchctl kickstart -k "gui/$(id -u)/com.bobigo.rpc-worker"
```

Kiểm tra:

```bash
launchctl print "gui/$(id -u)/com.bobigo.rpc-worker"
lsof -nP -iTCP:50052 -sTCP:LISTEN
tail -f "$HOME/Library/Logs/Bobigo/rpc-worker.log"
tail -f "$HOME/Library/Logs/Bobigo/rpc-worker.error.log"
```

Không cần thêm vòng lặp `while true` khi đã dùng `KeepAlive` của `launchd`.

## 5. Instruction cho Host Mac

Các lệnh trong phần này chạy trên Host.

### 5.1. Kiểm tra Worker trước khi nạp model

```bash
ping -c 3 192.168.100.2
nc -z -G 1 192.168.100.2 50052
```

Chỉ tiếp tục khi port `50052` kết nối được.

### 5.2. Build `llama-server` có RPC client

```bash
cd "$HOME/llama.cpp"
cmake -B build -DGGML_RPC=ON
cmake --build build --config Release -j
```

Kiểm tra `/Users/ssc1_1/Code/Chatbot_v1/scripts/start_backend.sh` đang dùng đúng binary `llama-server` có hỗ trợ RPC.

### 5.3. Khởi động llama-server với Worker

```bash
cd /Users/ssc1_1/Code/Chatbot_v1
export MODEL_PATH="/path/to/model.gguf"
export RPC_SERVER="192.168.100.2:50052"
export CONTEXT_WINDOW="8192"
bash scripts/start_backend.sh
```

Kiểm tra bắt buộc:

```bash
ps -ax -o pid,args | grep '[l]lama-server'
```

Process phải có:

```text
--rpc 192.168.100.2:50052
```

Nếu Worker offline, script hiện tại có thể fallback sang Single-Mac. Khi cần bắt buộc chạy hai máy, nên cải tiến script với `REQUIRE_RPC=1` để dừng thay vì fallback im lặng.

### 5.4. Khởi động Bobigo

Sau khi llama-server sẵn sàng:

```bash
cd /Users/ssc1_1/Code/Chatbot_v1
./run.sh
```

Các endpoint:

```text
Web UI:     http://localhost:8000
LLM API:    http://127.0.0.1:11434
PostgreSQL: 127.0.0.1:5433
Worker RPC: 192.168.100.2:50052
```

## 6. Kiểm tra sau reboot hoặc mất kết nối

### Worker

```bash
launchctl print "gui/$(id -u)/com.bobigo.rpc-worker"
lsof -nP -iTCP:50052 -sTCP:LISTEN
```

### Host

```bash
ping -c 3 192.168.100.2
nc -z -G 1 192.168.100.2 50052
ps -ax -o pid,args | grep '[l]lama-server'
curl -sf http://127.0.0.1:11434/v1/models
curl -sf http://127.0.0.1:11434/props
```

Nếu Worker khởi động sau Host, restart model sau khi port đã mở:

```bash
pkill -f 'llama-server.*--port 11434' || true
cd /Users/ssc1_1/Code/Chatbot_v1
RPC_SERVER=192.168.100.2:50052 bash scripts/start_backend.sh
```

Kết nối được xem là đúng khi đồng thời thỏa:

1. Worker listen `192.168.100.2:50052`.
2. Host kết nối TCP tới port đó.
3. Process `llama-server` có `--rpc 192.168.100.2:50052`.

## 7. Xử lý sự cố

### Worker không listen port

```bash
launchctl print "gui/$(id -u)/com.bobigo.rpc-worker"
tail -100 "$HOME/Library/Logs/Bobigo/rpc-worker.error.log"
test -x "$HOME/llama.cpp/build/bin/ggml-rpc-server" && echo OK
```

### Ping không được

```bash
ifconfig
networksetup -listallnetworkservices
```

Đảm bảo IP được đặt trên Thunderbolt Bridge, cáp là Thunderbolt thật và firewall không chặn.

### Port mở nhưng vẫn Single-Mac

```bash
ps -ax -o pid,args | grep '[l]lama-server'
```

Nếu thiếu `--rpc 192.168.100.2:50052`, restart `llama-server` sau khi Worker online.

### Worker sleep hoặc mất kết nối

```bash
pmset -g assertions
pmset -g custom
```

Đảm bảo Worker cắm nguồn, `sleep 0`, `disksleep 0`, LaunchAgent dùng `/usr/bin/caffeinate -ims`.

### RPC bị expose ngoài Thunderbolt

```bash
lsof -nP -iTCP:50052 -sTCP:LISTEN
```

Nếu thấy `0.0.0.0:50052`, đổi tham số RPC thành:

```text
-H 192.168.100.2
```

## 8. Cải tiến nên thực hiện trong repository

1. Sửa `/Users/ssc1_1/Code/Chatbot_v1/scripts/start_worker.sh` để mặc định bind `192.168.100.2`, dùng absolute path và `caffeinate -ims`.
2. Thêm `REQUIRE_RPC=1` vào `/Users/ssc1_1/Code/Chatbot_v1/scripts/start_backend.sh`.
3. Dùng `launchd` cho cả Worker RPC và Host `llama-server`.
4. Đặt `MODEL_PATH` cố định trong môi trường production, không tự chọn blob lớn nhất.
5. Đưa Worker IP/port vào biến môi trường thay vì hard-code trong dashboard.
6. Dashboard nên phân biệt: TCP reachable, RPC handshake thành công và `llama-server` có `--rpc`.
7. Ghi nhận reconnect count, lần cuối Worker online và lần restart gần nhất.

## 9. Checklist vận hành

### Worker

- [ ] Thunderbolt Bridge là `192.168.100.2/24`.
- [ ] Ping được Host `192.168.100.1`.
- [ ] llama.cpp build với `-DGGML_RPC=ON`.
- [ ] RPC bind `192.168.100.2:50052`, không phải `0.0.0.0`.
- [ ] Worker cắm nguồn và không sleep.
- [ ] `com.bobigo.rpc-worker` đang loaded.
- [ ] Port `50052` đang listen.

### Host

- [ ] Thunderbolt Bridge là `192.168.100.1/24`.
- [ ] `nc` tới `192.168.100.2:50052` thành công.
- [ ] `llama-server` có RPC client.
- [ ] Process có `--rpc 192.168.100.2:50052`.
- [ ] `/v1/models` và `/props` trả lời thành công.
- [ ] FastAPI/Web UI chạy sau khi LLM sẵn sàng.

## 10. Kết luận

Mô hình vận hành khuyến nghị là:

```text
Worker: launchd + caffeinate -ims + RPC bind IP Thunderbolt
Host:   kiểm tra RPC + llama-server --rpc + FastAPI/Web UI
Network: Thunderbolt Bridge IP tĩnh, chỉ mở port 50052 giữa hai IP
```

`launchd` giữ RPC luôn chạy và tự phục hồi. `pmset`/`caffeinate` giữ Worker không ngủ. Host phải khởi động `llama-server` sau khi Worker sẵn sàng và phải xác minh cờ `--rpc`; chỉ thấy Worker Online trên dashboard là chưa đủ để kết luận model đang chạy trên cả hai máy.
#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Worker Setup Script (Chạy trên máy Worker)
# Thiết lập chuẩn: Tắt ngủ vĩnh viễn + Cố định IP 192.168.100.2 + Cài đặt LaunchAgent
# ==============================================================================
set -euo pipefail

echo "========================================================"
echo "🚀 BẮT ĐẦU CẤU HÌNH MÁY WORKER BOBIGO AI STUDIO"
echo "========================================================"

LLAMA_DIR="${HOME}/llama.cpp"
PLIST_LABEL="com.bobigo.rpc-worker"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/Bobigo"

# 1. Tìm binary ggml-rpc-server hoặc rpc-server
RPC_BIN=""
if [ -x "${LLAMA_DIR}/build/bin/ggml-rpc-server" ]; then
    RPC_BIN="${LLAMA_DIR}/build/bin/ggml-rpc-server"
elif [ -x "${LLAMA_DIR}/build/bin/rpc-server" ]; then
    RPC_BIN="${LLAMA_DIR}/build/bin/rpc-server"
else
    # Thử tìm trong toàn bộ máy
    FOUND=$(find "${HOME}" -name "ggml-rpc-server" -type f -perm +111 2>/dev/null | head -n 1)
    if [ -n "$FOUND" ]; then
        RPC_BIN="$FOUND"
        LLAMA_DIR="$(dirname "$(dirname "$(dirname "$FOUND")")")"
    fi
fi

if [ -z "$RPC_BIN" ] || [ ! -x "$RPC_BIN" ]; then
    echo "❌ Không tìm thấy file chạy ggml-rpc-server trong ${LLAMA_DIR}."
    echo "👉 Hãy đảm bảo đã build llama.cpp: cmake -B build -DGGML_RPC=ON && cmake --build build --config Release -j"
    exit 1
fi
echo "✅ Đã tìm thấy RPC binary: $RPC_BIN"

# 2. Cố định IP tĩnh 192.168.100.2 trên cổng Thunderbolt
echo "🌐 Đang cấu hình IP tĩnh 192.168.100.2 cho cổng Thunderbolt..."
TB_SERVICE=$(networksetup -listnetworkserviceorder 2>/dev/null | grep -B 1 "Thunderbolt" | head -n 1 | sed -E 's/^\([0-9]+\) //' || true)
if [ -z "$TB_SERVICE" ]; then
    TB_SERVICE="Thunderbolt Bridge"
fi

networksetup -setmanual "$TB_SERVICE" 192.168.100.2 255.255.255.0 2>/dev/null || true
networksetup -setnetworkserviceenabled "$TB_SERVICE" off 2>/dev/null || true
networksetup -setnetworkserviceenabled "$TB_SERVICE" on 2>/dev/null || true

# 3. Tắt ngủ vĩnh viễn ở cấp độ kernel
echo "⚡ Tắt chế độ ngủ (Sleep) để bảo vệ cổng kết nối..."
sudo pmset -a disablesleep 1 2>/dev/null || true
sudo pmset -a sleep 0 2>/dev/null || true
sudo pmset -a displaysleep 0 2>/dev/null || true
sudo pmset -a disksleep 0 2>/dev/null || true

# 4. Tạo thư mục log và file LaunchAgent
mkdir -p "${HOME}/Library/LaunchAgents" "$LOG_DIR"

# Dừng dịch vụ cũ nếu đang chạy
launchctl unload "$PLIST_PATH" 2>/dev/null || true
killall -9 ggml-rpc-server rpc-server 2>/dev/null || true

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/caffeinate</string>
        <string>-dimsu</string>
        <string>${RPC_BIN}</string>
        <string>-H</string>
        <string>0.0.0.0</string>
        <string>-p</string>
        <string>50052</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${LLAMA_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>2</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/rpc-worker.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/rpc-worker.err.log</string>
</dict>
</plist>
EOF

# 5. Kích hoạt LaunchAgent
launchctl load -w "$PLIST_PATH"
sleep 2

# 6. Kiểm tra trạng thái
echo "--------------------------------------------------------"
if lsof -nP -iTCP:50052 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "🎉 HOÀN TẤT THÀNH CÔNG! Dịch vụ RPC Worker đang chạy ngầm trên cổng 50052."
    echo "👉 Tự động khởi động cùng macOS khi bật máy."
    echo "👉 Tự động hồi sinh trong 1 giây nếu gặp lỗi (KeepAlive: true)."
    echo "👉 Xem log tại: tail -f ${LOG_DIR}/rpc-worker.log"
else
    echo "⚠️ Dịch vụ đã nạp nhưng chưa thấy mở cổng 50052. Vui lòng kiểm tra log: ${LOG_DIR}/rpc-worker.err.log"
fi
echo "========================================================"

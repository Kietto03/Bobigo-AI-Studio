#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Set & Persist Metal GPU Wired Memory Limit (20GB)
# Usage: sudo ./scripts/set_wired_memory.sh
# ==============================================================================
set -euo pipefail

TARGET_MB="${1:-20480}"
PLIST_PATH="/Library/LaunchDaemons/com.bobigo.iogpu.plist"

echo "========================================================"
echo "⚡ Thiết lập giới hạn bộ nhớ GPU Metal: ${TARGET_MB} MB (~20 GB)"
echo "========================================================"

if [[ $EUID -ne 0 ]]; then
    echo "⚠️ Lệnh này cần quyền root (sudo) để ghi vào sysctl và /Library/LaunchDaemons."
    echo "👉 Vui lòng chạy: sudo $0"
    exit 1
fi

# 1. Apply immediately to running kernel
echo "▶ Đang áp dụng vào kernel hiện tại..."
/usr/sbin/sysctl "iogpu.wired_limit_mb=$TARGET_MB" 2>/dev/null || true
/usr/sbin/sysctl "debug.iogpu.wired_limit=$TARGET_MB" 2>/dev/null || true

# 2. Create LaunchDaemon to persist across reboots
echo "▶ Đang tạo LaunchDaemon tự kích hoạt sau khi khởi động: $PLIST_PATH"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bobigo.iogpu</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/sbin/sysctl</string>
        <string>iogpu.wired_limit_mb=$TARGET_MB</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

chmod 644 "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"

# 3. Load daemon
launchctl bootout system "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap system "$PLIST_PATH" 2>/dev/null || true

echo ""
echo "✅ HOÀN TẤT CẤU HÌNH!"
echo "   Giá trị hiện tại:"
/usr/sbin/sysctl iogpu.wired_limit_mb 2>/dev/null || true
echo "   LaunchDaemon: Đã cài đặt tự động duy trì 20GB sau mỗi lần reboot."
echo "========================================================"

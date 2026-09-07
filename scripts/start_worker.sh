#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Worker Node Launch Script with Caffeinate (Keep-Alive)
# Run this on the Worker Mac Mini to share Metal GPU over Thunderbolt
# ==============================================================================
set -euo pipefail

PORT="${RPC_PORT:-50052}"
HOST="${RPC_HOST:-192.168.100.2}"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$HOME/llama.cpp}"

echo "========================================================"
echo "⚡ Khởi động Bobigo RPC Worker Node (Dual-Mac Metal GPU)"
echo "   Endpoint: $HOST:$PORT"
echo "   Chế độ: Caffeinate Anti-Sleep Active (Giữ máy luôn thức)"
echo "========================================================"

# Locate binary
RPC_BIN=""
if [ -x "$LLAMA_CPP_DIR/build/bin/ggml-rpc-server" ]; then
    RPC_BIN="$LLAMA_CPP_DIR/build/bin/ggml-rpc-server"
elif [ -x "$LLAMA_CPP_DIR/build/bin/rpc-server" ]; then
    RPC_BIN="$LLAMA_CPP_DIR/build/bin/rpc-server"
else
    echo "❌ Không tìm thấy binary ggml-rpc-server hoặc rpc-server trong ./build/bin/"
    echo "   Hãy đặt LLAMA_CPP_DIR đúng thư mục llama.cpp rồi chạy lại."
    exit 1
fi

echo "🚀 Đang chạy: $RPC_BIN -H $HOST -p $PORT"
echo "💡 Máy sẽ KHÔNG tự động ngủ, duy trì kết nối Thunderbolt 24/7."
echo "   (Nhấn Ctrl+C để dừng)"
echo "--------------------------------------------------------"

# Loop with caffeinate -ims:
# -i: prevent idle sleep
# -m: prevent disk idle sleep
# -s: prevent system sleep when plugged into AC
while true; do
    /usr/bin/caffeinate -ims "$RPC_BIN" -H "$HOST" -p "$PORT" || true
    echo "⚠️ Tiến trình RPC dừng, đang tự động khởi động lại sau 2 giây..."
    sleep 2
done

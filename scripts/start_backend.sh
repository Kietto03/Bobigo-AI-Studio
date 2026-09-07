#!/bin/bash
# ==============================================================================
# Bobigo AI Studio — llama-server Watchdog Supervisor (Metal + --jinja + Auto-Restart)
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${LLM_PORT:-11434}"
MODEL_PATH="${MODEL_PATH:-}"
CONTEXT_WINDOW="${CONTEXT_WINDOW:-16384}"
RPC_SERVER="${RPC_SERVER:-192.168.100.2:50052}"
REQUIRE_RPC="${REQUIRE_RPC:-0}"

# 1. Honor MODEL_PATH, else search Ollama cache for Qwen 35B blob
if [ -z "$MODEL_PATH" ] || [ ! -f "$MODEL_PATH" ]; then
    FOUND_BLOB=$(find ~/.ollama/models/blobs/ -type f -size +10G 2>/dev/null | head -n 1)
    if [ -n "$FOUND_BLOB" ]; then
        MODEL_PATH="$FOUND_BLOB"
    elif [ -f "$HOME/models/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf" ]; then
        MODEL_PATH="$HOME/models/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf"
    fi
fi

if [ -n "$MODEL_PATH" ] && [ -f "$MODEL_PATH" ]; then
    echo "🔍 Detected Local Model: $MODEL_PATH"
else
    echo "❌ No GGUF model file found."
    echo "Set MODEL_PATH=/path/to/model.gguf or download: ollama pull qwen3.6-35b"
    exit 1
fi

# 2. Check if a TCP listener is already running on the API port.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "✅ llama-server or API process is already running on port $PORT."
    exit 0
fi

# 3. Choose llama-server binary (prefer build with RPC support)
LLAMA_SERVER_BIN="llama-server"
if [ -x "/Users/ssc1_1/Code/llama.cpp/build/bin/llama-server" ]; then
    LLAMA_SERVER_BIN="/Users/ssc1_1/Code/llama.cpp/build/bin/llama-server"
elif [ -x "$PROJECT_DIR/../llama.cpp/build/bin/llama-server" ]; then
    LLAMA_SERVER_BIN="$PROJECT_DIR/../llama.cpp/build/bin/llama-server"
fi

trap 'echo "🛑 Đang dừng backend supervisor..."; exit 0' SIGINT SIGTERM

# 4. Supervisor Loop (Auto-recovers from crashes & network drops)
while true; do
    RPC_ARGS=()
    if [ "$RPC_SERVER" != "none" ] && [ "$RPC_SERVER" != "off" ] && [ -n "$RPC_SERVER" ]; then
        RPC_HOST="${RPC_SERVER%%:*}"
        RPC_PORT="${RPC_SERVER##*:}"

        # Ensure Host has 192.168.100.1 assigned if targeting 192.168.100.x
        if [[ "$RPC_HOST" == 192.168.100.* ]] && ! ifconfig | grep -q "192.168.100.1"; then
            echo "⚙️ Đang tự động gán lại IP tĩnh 192.168.100.1 trên Host Thunderbolt..."
            networksetup -setmanual "EXO Thunderbolt 1" 192.168.100.1 255.255.255.0 >/dev/null 2>&1 || true
            networksetup -setnetworkserviceenabled "EXO Thunderbolt 1" off >/dev/null 2>&1 || true
            networksetup -setnetworkserviceenabled "EXO Thunderbolt 1" on >/dev/null 2>&1 || true
            sleep 2
        fi

        if nc -z -G 3 "$RPC_HOST" "$RPC_PORT" >/dev/null 2>&1; then
            echo "🔗 Kết nối RPC Worker thành công: $RPC_SERVER (Đang chạy Dual-Mac GPU Cluster)"
            RPC_ARGS=(--rpc "$RPC_SERVER")
        else
            echo "⚠️ Không phát hiện RPC Server đang chạy tại $RPC_SERVER."
            echo "   👉 Để chạy 2 máy: hãy bật trên máy phụ: ./scripts/setup_worker_service.sh"
            if [ "$REQUIRE_RPC" = "1" ]; then
                echo "⏳ REQUIRE_RPC=1: Đang chờ Worker RPC mở cổng $RPC_PORT (thử lại sau 3s)..."
                sleep 3
                continue
            fi
            echo "   👉 Tạm thời khởi chạy ở chế độ đơn máy (Local GPU)..."
        fi
    fi

    echo "🚀 Starting llama-server on port $PORT (Metal GPU, Context: $CONTEXT_WINDOW, Single Slot)..."
    "$LLAMA_SERVER_BIN" \
      -m "$MODEL_PATH" \
      --port "$PORT" \
      -ngl 99 \
      -c "$CONTEXT_WINDOW" \
      -np 1 \
      --host 127.0.0.1 \
      --jinja \
      "${RPC_ARGS[@]}" || true

    echo "⚠️ llama-server đã dừng. Đang tự động kiểm tra và khởi động lại sau 2 giây..."
    sleep 2
done

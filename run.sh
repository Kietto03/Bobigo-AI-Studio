#!/bin/bash
# ==============================================================================
# Bobigo AI Studio — Main All-in-One Launcher Script
# Run this script to launch llama-server + Web UI and open your browser!
# Usage: ./run.sh
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PYTHON="python3"
if [ -x "$PROJECT_DIR/.venv/bin/python3" ]; then
    PYTHON="$PROJECT_DIR/.venv/bin/python3"
fi

echo "=================================================================="
echo "🤖 Starting Bobigo AI Studio (Qwen 35B Local LLM Workbench)..."
echo "=================================================================="

# Function to clean up background processes on Ctrl+C
cleanup() {
    echo -e "\n🛑 Shutting down Bobigo AI Studio services..."
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null
    fi
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

# 1. Start llama-server backend if not already running on port 11434
if ! lsof -i:11434 >/dev/null 2>&1; then
    echo "⚙️ Starting llama-server on port 11434 (Metal + --jinja)..."
    bash "$PROJECT_DIR/scripts/start_backend.sh" > "$PROJECT_DIR/backend.log" 2>&1 &
    BACKEND_PID=$!

    echo -n "⏳ Waiting for model to load (up to 3 minutes)..."
    READY=0
    for i in {1..180}; do
        if curl -sf http://127.0.0.1:11434/v1/models >/dev/null 2>&1; then
            echo -e "\n✅ Backend model loaded and ready!"
            READY=1
            break
        fi
        if [ $((i % 10)) -eq 0 ]; then
            echo -n " ${i}s"
        else
            echo -n "."
        fi
        sleep 1
    done
    if [ "$READY" -ne 1 ]; then
        echo -e "\n⚠️  Model chưa sẵn sàng sau 180s. UI vẫn mở — chờ chấm trạng thái chuyển xanh."
    fi
else
    echo "✅ llama-server đã chạy trên port 11434."
    if ! pgrep -lf 'llama-server' | grep -q -- '--jinja'; then
        echo "⚠️  Tiến trình hiện tại có vẻ thiếu --jinja. Agent tools có thể không gọi được."
        echo "    Dừng llama-server rồi chạy lại ./run.sh để bật tool calling."
    fi
fi

# 2. Start Web UI Server on port 8000
echo "🌐 Starting Web UI server on http://localhost:8000..."
"$PYTHON" "$PROJECT_DIR/server.py" &
SERVER_PID=$!

sleep 1

# 3. Open browser automatically
echo "🚀 Opening Bobigo AI Studio in default browser..."
if command -v open >/dev/null 2>&1; then
    open "http://localhost:8000"
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:8000"
fi

echo ""
echo "=================================================================="
echo "🎉 Bobigo Studio is Live at: http://localhost:8000"
echo "Press Ctrl+C to stop the application."
echo "=================================================================="

# Wait for server process
wait $SERVER_PID

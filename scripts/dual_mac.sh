#!/usr/bin/env bash
# ==============================================================================
# Bobigo Dual-Mac one-command operator.
# ==============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_IP="${HOST_IP:-192.168.100.1}"
WORKER_IP="${WORKER_IP:-192.168.100.2}"
RPC_PORT="${RPC_PORT:-50052}"
LLM_PORT="${LLM_PORT:-11434}"
RPC_SERVER="${RPC_SERVER:-$WORKER_IP:$RPC_PORT}"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$HOME/llama.cpp}"
MODEL_PATH="${MODEL_PATH:-}"
PLIST_LABEL="com.bobigo.rpc-worker"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Bobigo"

die() { echo "❌ $*" >&2; exit 1; }
say() { echo "▶ $*"; }

worker_binary() {
    if [[ -x "$LLAMA_CPP_DIR/build/bin/ggml-rpc-server" ]]; then
        echo "$LLAMA_CPP_DIR/build/bin/ggml-rpc-server"
    elif [[ -x "$LLAMA_CPP_DIR/build/bin/rpc-server" ]]; then
        echo "$LLAMA_CPP_DIR/build/bin/rpc-server"
    else
        return 1
    fi
}

fix_network() {
    say "Cố định IP $HOST_IP trên cổng Thunderbolt..."
    local tb_service="Thunderbolt Bridge"
    networksetup -setmanual "$tb_service" "$HOST_IP" 255.255.255.0 2>/dev/null || true
    networksetup -setnetworkserviceenabled "$tb_service" off 2>/dev/null || true
    networksetup -setnetworkserviceenabled "$tb_service" on 2>/dev/null || true
    sleep 2
    if ifconfig | grep -q "$HOST_IP"; then
        echo "✅ Đã gán thành công IP $HOST_IP trên Host"
    else
        echo "⚠️ Chưa thấy $HOST_IP trong ifconfig. Vui lòng kiểm tra cáp."
    fi
}

check_worker() {
    say "Kiểm tra Worker $RPC_SERVER"
    if ! ifconfig | grep -q "$HOST_IP"; then
        fix_network
    fi
    nc -z -G 3 "$WORKER_IP" "$RPC_PORT" >/dev/null 2>&1 || die "Worker RPC chưa reachable: $RPC_SERVER (hãy bật ./scripts/setup_worker_service.sh trên Worker)"
    echo "✅ Worker RPC reachable"
}

model_path() {
    if [[ -n "$MODEL_PATH" && -f "$MODEL_PATH" ]]; then
        echo "$MODEL_PATH"
        return
    fi
    local found_blob
    found_blob=$(find "$HOME/.ollama/models/blobs" -type f -size +10G -print 2>/dev/null | head -n 1)
    if [[ -n "$found_blob" ]]; then
        echo "$found_blob"
        return
    fi
    if [[ -f "$HOME/models/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf" ]]; then
        echo "$HOME/models/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf"
        return
    fi
    find "$HOME/models" -type f -name "*.gguf" 2>/dev/null | head -n 1
}

write_worker_plist() {
    local bin="$1"
    mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR"
    cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$PLIST_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/caffeinate</string><string>-dimsu</string>
    <string>$bin</string><string>-H</string><string>0.0.0.0</string>
    <string>-p</string><string>$RPC_PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$LLAMA_CPP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/rpc-worker.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/rpc-worker.error.log</string>
</dict></plist>
EOF
    plutil -lint "$PLIST_PATH" >/dev/null || die "plist không hợp lệ: $PLIST_PATH"
}

install_worker() {
    [[ "$(uname -s)" == "Darwin" ]] || die "Worker launcher chỉ hỗ trợ macOS"
    local bin
    bin="$(worker_binary)" || die "Không tìm thấy ggml-rpc-server/rpc-server trong $LLAMA_CPP_DIR/build/bin"
    write_worker_plist "$bin"
    launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
    launchctl enable "gui/$(id -u)/$PLIST_LABEL"
    launchctl kickstart -k "gui/$(id -u)/$PLIST_LABEL"
    say "Worker service đã cài: $PLIST_LABEL"
    status_worker
}

uninstall_worker() {
    launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
    rm -f "$PLIST_PATH"
    echo "✅ Đã gỡ $PLIST_LABEL"
}

status_worker() {
    if launchctl print "gui/$(id -u)/$PLIST_LABEL" >/dev/null 2>&1; then
        echo "✅ launchd: $PLIST_LABEL loaded"
    else
        echo "⚠️ launchd: $PLIST_LABEL chưa loaded"
    fi
    if lsof -nP -iTCP:"$RPC_PORT" -sTCP:LISTEN 2>/dev/null; then :; else echo "⚠️ RPC port $RPC_PORT chưa listen"; fi
}

status_host() {
    echo "--- 1. Mạng Thunderbolt ---"
    if ifconfig | grep -q "$HOST_IP"; then
        echo "✅ Host IP: $HOST_IP"
    else
        echo "❌ Host IP chưa có $HOST_IP (dùng: ./scripts/dual_mac.sh fix-network)"
    fi
    if ping -c 1 -W 1000 "$WORKER_IP" >/dev/null 2>&1; then
        echo "✅ Ping Worker $WORKER_IP: OK"
    else
        echo "❌ Ping Worker $WORKER_IP: THẤT BẠI"
    fi
    if netstat -an 2>/dev/null | grep -E "192\.168\.100\.2[\.:]50052.*ESTABLISHED" >/dev/null 2>&1; then
        echo "✅ Cổng RPC Worker $RPC_SERVER: ĐANG HOẠT ĐỘNG (ESTABLISHED)"
    elif nc -z -G 2 "$WORKER_IP" "$RPC_PORT" >/dev/null 2>&1; then
        echo "✅ Cổng RPC Worker $RPC_SERVER: MỞ (SẴN SÀNG)"
    else
        echo "❌ Cổng RPC Worker $RPC_SERVER: ĐÓNG"
    fi

    echo "--- 2. Tiến trình LLM ---"
    if pgrep -f llama-server >/dev/null 2>&1; then
        echo "✅ llama-server đang chạy (Port $LLM_PORT)"
    else
        echo "ℹ️  llama-server không chạy"
    fi
    if pgrep -f 'exo' | grep -v 'EXO.app' >/dev/null 2>&1 || pgrep -f 'EXO' >/dev/null 2>&1; then
        echo "✅ EXO Cluster engine đang chạy (Port 52415)"
    else
        echo "ℹ️  EXO Cluster không chạy"
    fi

    if curl -m 2 -sf "http://127.0.0.1:$LLM_PORT/v1/models" >/dev/null 2>&1; then
        echo "✅ LLM API (Port $LLM_PORT): READY"
    fi
    if curl -m 2 -sf "http://127.0.0.1:52415/v1/models" >/dev/null 2>&1; then
        echo "✅ EXO API (Port 52415): READY"
    fi
    if curl -m 2 -sf "http://${WORKER_IP}:${LLM_PORT}/v1/models" >/dev/null 2>&1; then
        echo "✅ Worker Speculative MLX API ($WORKER_IP:$LLM_PORT): READY"
    else
        echo "ℹ️  Worker Speculative MLX API ($WORKER_IP:$LLM_PORT): Chưa bật"
    fi

    echo "--- 3. Web & API Health ---"
    if curl -m 3 -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
        echo "✅ FastAPI Backend ready (port 8000)"
    else
        echo "⚠️ FastAPI Backend chưa ready"
    fi
}

start_speculative() {
    say "=== Khởi động Chế độ Speculative Decoding (Draft 0.8B + Target 27B) ==="
    if ! ifconfig | grep -q "$HOST_IP"; then
        fix_network
    fi
    if ! ping -c 1 -W 1000 "$WORKER_IP" >/dev/null 2>&1; then
        die "Không ping được Worker qua cáp Thunderbolt ($WORKER_IP). Hãy kiểm tra cáp."
    fi

    say "Dừng llama-server và EXO trên Host để giải phóng RAM tối đa..."
    stop_host
    stop_exo
    sleep 1

    say "Kiểm tra Worker Speculative Engine tại http://$WORKER_IP:$LLM_PORT/v1/models..."
    local ready=0
    for i in $(seq 1 10); do
        if curl -sf "http://$WORKER_IP:$LLM_PORT/v1/models" >/dev/null 2>&1; then
            ready=1
            break
        fi
        sleep 1
    done

    if [[ "$ready" -ne 1 ]]; then
        echo "⚠️ Chưa thấy Worker Speculative Engine phản hồi trên http://$WORKER_IP:$LLM_PORT."
        echo "👉 Hãy đảm bảo trên MÁY WORKER bạn đã chạy:"
        echo "   cd ~/Code/Chatbot_v1 && git pull"
        echo "   ./scripts/sync_draft_to_worker.sh"
        echo "   ./scripts/start_speculative_worker.sh"
        echo "⏳ Đang đợi Worker sẵn sàng..."
        while ! curl -sf "http://$WORKER_IP:$LLM_PORT/v1/models" >/dev/null 2>&1; do
            sleep 2
        done
    fi
    echo "✅ Worker Speculative Engine ĐÃ SẴN SÀNG!"

    say "Khởi động FastAPI Backend trên Host kết nối sang Worker ($WORKER_IP:$LLM_PORT)..."
    pkill -f 'python.*server.py' 2>/dev/null || true
    export LLM_BASE_URL="http://$WORKER_IP:$LLM_PORT"
    export DEFAULT_MODEL="Qwen3.8-27B-Uncensored"
    nohup "$PROJECT_DIR/.venv/bin/python" "$PROJECT_DIR/server.py" > "$PROJECT_DIR/backend-speculative.log" 2>&1 &
    sleep 2

    if curl -m 3 -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
        echo "========================================================"
        echo "🎉 BOBIGO AI STUDIO ĐÃ HOẠT ĐỘNG VỚI SPECULATIVE DECODING!"
        echo "   Engine: Worker ($WORKER_IP:$LLM_PORT) [Draft 0.8B + Target 27B]"
        echo "   Studio: http://localhost:8000"
        echo "   Tốc độ dự kiến: 30 - 45 TPS (Gấp 8x so với EXO Pipeline)"
        echo "========================================================"
    else
        echo "⚠️ Backend đang khởi động, xem log: tail -f $PROJECT_DIR/backend-speculative.log"
    fi
}

stop_speculative() {
    pkill -f 'python.*server.py' 2>/dev/null || true
    echo "✅ Đã dừng Bobigo Backend Speculative mode"
}

start_host() {
    check_worker
    local model
    model="$(model_path)"
    [[ -n "$model" && -f "$model" ]] || die "Không tìm thấy MODEL_PATH; đặt MODEL_PATH=/path/model.gguf"
    if lsof -nP -iTCP:"$LLM_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        if ! ps -ax -o args | grep '[l]lama-server' | grep -q -- "--rpc $RPC_SERVER"; then
            die "Port $LLM_PORT đang bận bởi tiến trình khác; hãy dùng: ./scripts/dual_mac.sh stop-host"
        fi
        echo "✅ llama-server đã chạy với $RPC_SERVER"
    else
        say "Khởi động llama-server Supervisor với RPC"
        MODEL_PATH="$model" RPC_SERVER="$RPC_SERVER" REQUIRE_RPC=1 CONTEXT_WINDOW="${CONTEXT_WINDOW:-16384}" \
            bash "$PROJECT_DIR/scripts/start_backend.sh" > "$PROJECT_DIR/backend-rpc.log" 2>&1 &
        echo "PID launcher: $!"
    fi
    say "Chờ LLM API (tối đa ${LLM_WAIT_SECONDS:-180}s)"
    for _ in $(seq 1 "${LLM_WAIT_SECONDS:-180}"); do
        if curl -sf "http://127.0.0.1:$LLM_PORT/v1/models" >/dev/null 2>&1; then
            echo "✅ Dual-Mac LLM ready"
            status_host
            return
        fi
        sleep 1
    done
    tail -80 "$PROJECT_DIR/backend-rpc.log" 2>/dev/null || true
    die "LLM chưa ready; xem $PROJECT_DIR/backend-rpc.log"
}

start_exo() {
    say "Dừng llama-server để giải phóng RAM cho MLX..."
    stop_host
    sleep 2
    say "Khởi động EXO Cluster trên Host (Port 52415)..."
    nohup bash "$PROJECT_DIR/scripts/start_exo_host.sh" > "$PROJECT_DIR/exo-host.log" 2>&1 &
    local exo_pid=$!
    echo "EXO Host PID: $exo_pid"
    say "Chờ EXO Cluster API sẵn sàng (tối đa 30s)..."
    for _ in $(seq 1 30); do
        if curl -sf "http://127.0.0.1:52415/v1/models" >/dev/null 2>&1; then
            echo "✅ EXO Cluster API đã sẵn sàng trên http://127.0.0.1:52415"
            echo "👉 Dashboard: http://localhost:52415"
            return
        fi
        sleep 1
    done
    echo "⚠️ EXO đang khởi động ngầm, xem log: tail -f $PROJECT_DIR/exo-host.log"
}

stop_exo() {
    pkill -f 'start_exo_host.sh' 2>/dev/null || true
    pkill -f '/exo' 2>/dev/null || true
    echo "✅ Đã dừng EXO Cluster trên Host"
}

stop_host() {
    pkill -f 'start_backend.sh' 2>/dev/null || true
    pkill -f 'llama-server' 2>/dev/null || true
    echo "✅ Đã dừng backend supervisor và llama-server"
}

restart_host() {
    say "Khởi động lại toàn bộ Host..."
    stop_host
    sleep 2
    fix_network
    start_host
}

usage() {
    cat <<EOF
Usage: $(basename "$0") <command>

Worker Mac:
  install-worker       Cài launchd RPC worker và tự khởi động (llama.cpp)
  uninstall-worker     Gỡ launchd RPC worker
  status-worker        Kiểm tra launchd và port RPC
  start-exo-worker     Chạy EXO worker node (MLX)

Host Mac:
  start-speculative    [Khuyên Dùng B1] Kết nối Worker Speculative Decoding (30-45 TPS)
  stop-speculative     Dừng kết nối Speculative
  connect              Kiểm tra Worker, khởi động llama-server với --rpc (Qwen 35B)
  start-exo            Khởi động cụm phân tán EXO (Qwen 3.8 MLX)
  stop-exo             Dừng cụm EXO
  restart              Dừng, sửa mạng và khởi động lại toàn bộ Host (llama.cpp)
  status               Kiểm tra toàn diện Mạng, RPC, Speculative, EXO, llama-server và Web API
  fix-network          Cố định lại IP 192.168.100.1 trên cáp Thunderbolt
  stop-host            Dừng llama-server & supervisor

Environment:
  MODEL_PATH=/path/model.gguf
  LLAMA_CPP_DIR=\$HOME/llama.cpp
  WORKER_IP=192.168.100.2 RPC_PORT=50052
EOF
}

case "${1:-}" in
    install-worker) install_worker ;;
    uninstall-worker) uninstall_worker ;;
    status-worker) status_worker ;;
    start-speculative) start_speculative ;;
    stop-speculative) stop_speculative ;;
    connect|start-host) start_host ;;
    start-exo) start_exo ;;
    stop-exo) stop_exo ;;
    restart) restart_host ;;
    status) status_host ;;
    fix-network) fix_network ;;
    stop-host) stop_host ;;
    *) usage; exit 2 ;;
esac
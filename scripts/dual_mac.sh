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
    local tb_service="EXO Thunderbolt 1"
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
        echo "✅ llama-server đang chạy"
    else
        echo "⚠️ llama-server chưa chạy"
    fi
    if curl -m 3 -sf "http://127.0.0.1:$LLM_PORT/v1/models" >/dev/null 2>&1; then
        echo "✅ LLM API ready (port $LLM_PORT)"
    else
        echo "⚠️ LLM API chưa ready"
    fi

    echo "--- 3. Web & API Health ---"
    if curl -m 3 -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1; then
        echo "✅ FastAPI Backend ready (port 8000)"
    else
        echo "⚠️ FastAPI Backend chưa ready"
    fi
}

start_host() {
    check_worker
    local model
    model="$(model_path)"
    [[ -n "$model" && -f "$model" ]] || die "Không tìm thấy MODEL_PATH; đặt MODEL_PATH=/path/model.gguf"
    if lsof -nP -iTCP:"$LLM_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        if ! ps -ax -o args | grep '[l]lama-server' | grep -q -- "--rpc $RPC_SERVER"; then
            die "Port $LLM_PORT đang bận bởi llama-server không có --rpc; hãy dùng: ./scripts/dual_mac.sh restart"
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
  install-worker    Cài launchd RPC worker và tự khởi động
  uninstall-worker  Gỡ launchd RPC worker
  status-worker     Kiểm tra launchd và port RPC

Host Mac:
  connect           Kiểm tra Worker, khởi động llama-server với --rpc
  restart           Dừng, sửa mạng và khởi động lại toàn bộ Host
  status            Kiểm tra toàn diện Mạng, RPC, llama-server và Web API
  fix-network       Cố định lại IP 192.168.100.1 trên cáp Thunderbolt
  stop-host         Dừng llama-server & supervisor

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
    connect|start-host) start_host ;;
    restart) restart_host ;;
    status) status_host ;;
    fix-network) fix_network ;;
    stop-host) stop_host ;;
    *) usage; exit 2 ;;
esac
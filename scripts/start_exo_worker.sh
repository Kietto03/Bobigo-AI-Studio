#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Launch EXO Distributed Cluster (Worker Node)
# Run this on the Worker Mac Mini to join the MLX cluster over Thunderbolt
# ==============================================================================
set -euo pipefail

HOST_IP="${HOST_IP:-192.168.100.1}"
WORKER_IP="${WORKER_IP:-192.168.100.2}"

echo "========================================================"
echo "⚡ Khởi động EXO Cluster (Worker Node)"
echo "   Host Target: $HOST_IP"
echo "   Worker IP:   $WORKER_IP"
echo "========================================================"

# Check and fix network on Worker
echo "🌐 Đang kiểm tra cổng mạng Thunderbolt..."
TB_SERVICE=$(networksetup -listnetworkserviceorder 2>/dev/null | grep -B 1 "Thunderbolt" | head -n 1 | sed -E 's/^\([0-9]+\) //' || true)
if [[ -z "$TB_SERVICE" ]]; then
    TB_SERVICE="EXO Thunderbolt 1"
fi
networksetup -setmanual "$TB_SERVICE" "$WORKER_IP" 255.255.255.0 2>/dev/null || true

# Anti-sleep
sudo pmset -a disablesleep 1 2>/dev/null || true

# Locate exo
EXO_BIN=""
if command -v exo >/dev/null 2>&1; then
    EXO_BIN="$(command -v exo)"
elif [[ -x "/Applications/EXO.app/Contents/Resources/exo/exo" ]]; then
    EXO_BIN="/Applications/EXO.app/Contents/Resources/exo/exo"
else
    echo "❌ Không tìm thấy binary exo trên Worker. Hãy cài đặt: brew install --cask exo"
    exit 1
fi

LIBP2P_PORT="${EXO_LIBP2P_PORT:-52416}"

echo "🚀 Đang kết nối vào cụm MLX tại $HOST_IP:$LIBP2P_PORT..."
exec /usr/bin/caffeinate -dimsu "$EXO_BIN" --no-api --libp2p-port "$LIBP2P_PORT" --bootstrap-peers "${HOST_IP}:${LIBP2P_PORT}" "$@"

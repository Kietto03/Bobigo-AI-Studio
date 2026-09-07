#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Launch EXO Distributed Cluster (Host Node)
# Uses Apple Silicon MLX backend distributed across Thunderbolt
# ==============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${EXO_API_PORT:-52415}"
HOST_IP="${HOST_IP:-192.168.100.1}"

echo "========================================================"
echo "⚡ Khởi động EXO Cluster (Host Node) cho Bobigo"
echo "   API Endpoint: http://0.0.0.0:${API_PORT}"
echo "   Model: orcarouter/Qwen3.8-27B-Uncensored-MLX"
echo "========================================================"

# Check network
if ! ifconfig | grep -q "$HOST_IP"; then
    echo "🌐 Đang kích hoạt IP $HOST_IP trên cáp Thunderbolt..."
    networksetup -setmanual "EXO Thunderbolt 1" "$HOST_IP" 255.255.255.0 2>/dev/null || true
fi

# Ensure symlink in ~/.exo/models
mkdir -p "$HOME/.exo/models"
if [[ -d "$HOME/models/Qwen3.8-27B-Uncensored-MLX-6bit" ]]; then
    ln -sfn "$HOME/models/Qwen3.8-27B-Uncensored-MLX-6bit" "$HOME/.exo/models/orcarouter--Qwen3.8-27B-Uncensored-MLX"
    echo "✅ Đã ánh xạ model: ~/.exo/models/orcarouter--Qwen3.8-27B-Uncensored-MLX"
fi

# Locate exo
EXO_BIN=""
if command -v exo >/dev/null 2>&1; then
    EXO_BIN="$(command -v exo)"
elif [[ -x "/Applications/EXO.app/Contents/Resources/exo/exo" ]]; then
    EXO_BIN="/Applications/EXO.app/Contents/Resources/exo/exo"
else
    echo "❌ Không tìm thấy binary exo. Hãy cài đặt: brew install --cask exo"
    exit 1
fi

echo "🚀 Đang khởi động EXO..."
exec "$EXO_BIN" --api-port "$API_PORT" "$@"

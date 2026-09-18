#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Launch MLX Native Speculative Decoding Server on Worker
# Run this on Worker Mac Mini: ./scripts/start_speculative_worker.sh
# ==============================================================================
set -euo pipefail

TARGET_MODEL="${TARGET_MODEL:-$HOME/.exo/models/orcarouter--Qwen3.8-27B-Uncensored-MLX}"
DRAFT_MODEL="${DRAFT_MODEL:-$HOME/.exo/models/Qwen3.5-0.8B-OptiQ-4bit}"
PORT="${PORT:-11434}"
HOST="${HOST:-0.0.0.0}"
USE_DRAFT="${USE_DRAFT:-0}"

echo "========================================================"
echo "⚡ Khởi động MLX Engine trên Worker Mac Mini"
echo "   Target Model (21GB): $TARGET_MODEL"
if [[ "$USE_DRAFT" == "1" ]]; then
    echo "   Draft Model  (700MB): $DRAFT_MODEL (Tokens: $NUM_DRAFT_TOKENS)"
else
    echo "   Chế độ: Native MLX Server (Tối ưu GPU Metal 100%, 0ms Network Latency)"
fi
echo "   Endpoint:             http://${HOST}:${PORT}"
echo "========================================================"

# Anti-sleep
sudo pmset -a disablesleep 1 2>/dev/null || true

# Find python with mlx_lm
EXEC_CMD=()
if command -v mlx_lm.server >/dev/null 2>&1; then
    EXEC_CMD=("mlx_lm.server")
elif python3 -m mlx_lm.server --help >/dev/null 2>&1; then
    EXEC_CMD=("python3" "-m" "mlx_lm.server")
elif [[ -x "$HOME/Code/Chatbot_v1/.venv/bin/python" ]]; then
    EXEC_CMD=("$HOME/Code/Chatbot_v1/.venv/bin/python" "-m" "mlx_lm.server")
elif [[ -x "$HOME/.venv/bin/python" ]]; then
    EXEC_CMD=("$HOME/.venv/bin/python" "-m" "mlx_lm.server")
else
    echo "❌ Không tìm thấy mlx_lm.server. Hãy chạy: pip install mlx mlx-lm"
    exit 1
fi

ARGS=(
  --model "$TARGET_MODEL"
  --host "$HOST"
  --port "$PORT"
)

if [[ -f "$TARGET_MODEL/chat_template.jinja" ]]; then
    ARGS+=(--chat-template "$TARGET_MODEL/chat_template.jinja")
fi

if [[ "$USE_DRAFT" == "1" ]]; then
    ARGS+=(--draft-model "$DRAFT_MODEL" --num-draft-tokens "$NUM_DRAFT_TOKENS")
fi

echo "🚀 Đang nạp mô hình vào GPU Metal..."
exec /usr/bin/caffeinate -dimsu "${EXEC_CMD[@]}" "${ARGS[@]}" "$@"


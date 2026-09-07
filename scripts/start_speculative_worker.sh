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
NUM_DRAFT_TOKENS="${NUM_DRAFT_TOKENS:-4}"

echo "========================================================"
echo "⚡ Khởi động MLX Speculative Decoding Engine trên Worker"
echo "   Target Model (21GB): $TARGET_MODEL"
echo "   Draft Model  (700MB): $DRAFT_MODEL"
echo "   Draft Tokens:         $NUM_DRAFT_TOKENS"
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

echo "🚀 Đang nạp Target + Draft Model vào GPU Metal..."
exec /usr/bin/caffeinate -dimsu "${EXEC_CMD[@]}" \
  --model "$TARGET_MODEL" \
  --draft-model "$DRAFT_MODEL" \
  --num-draft-tokens "$NUM_DRAFT_TOKENS" \
  --host "$HOST" \
  --port "$PORT" \
  --chat-template "$TARGET_MODEL/chat_template.jinja" \
  "$@"

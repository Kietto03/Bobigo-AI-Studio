#!/bin/bash
# ==============================================================================
# Bobigo AI Studio — Download Qwen3.8-27B Uncensored GGUF (with Auto-Resume)
# ==============================================================================

set -euo pipefail

TARGET_DIR="$HOME/models"
MODEL_NAME="Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf"
TARGET_FILE="$TARGET_DIR/$MODEL_NAME"
URL="https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q4_K_P.gguf"
EXPECTED_SIZE=17923393664

mkdir -p "$TARGET_DIR"

echo "📥 Bắt đầu tải mô hình: $MODEL_NAME"
echo "📂 Lưu tại: $TARGET_FILE"
echo "📏 Dung lượng dự kiến: ~17.92 GB ($EXPECTED_SIZE bytes)"
echo "--------------------------------------------------------"

# Loop with curl -C - to auto-resume on network glitch
while true; do
    CURRENT_SIZE=0
    if [ -f "$TARGET_FILE" ]; then
        CURRENT_SIZE=$(stat -f%z "$TARGET_FILE" 2>/dev/null || stat -c%s "$TARGET_FILE" 2>/dev/null || echo 0)
    fi

    if [ "$CURRENT_SIZE" -ge "$EXPECTED_SIZE" ]; then
        echo "✅ Tải thành công! Kích thước file hoàn chỉnh: $CURRENT_SIZE bytes."
        break
    fi

    echo "⏳ Đang tải (hiện có: $((CURRENT_SIZE / 1024 / 1024)) MB / $((EXPECTED_SIZE / 1024 / 1024)) MB)..."
    curl -C - \
         -L \
         --fail \
         --retry 10 \
         --retry-delay 5 \
         --progress-bar \
         -o "$TARGET_FILE" \
         "$URL" || true

    sleep 2
done

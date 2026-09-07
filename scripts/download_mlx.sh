#!/bin/bash
# ==============================================================================
# Bobigo AI Studio — Download orcarouter/Qwen3.8-27B-Uncensored-MLX (6-bit)
# ==============================================================================

set -euo pipefail

TARGET_DIR="$HOME/models/Qwen3.8-27B-Uncensored-MLX-6bit"
BASE_URL="https://huggingface.co/orcarouter/Qwen3.8-27B-Uncensored-MLX/resolve/main/6-bit"

mkdir -p "$TARGET_DIR"

FILES=(
  "README.md"
  "chat_template.jinja"
  "config.json"
  "generation_config.json"
  "model.safetensors.index.json"
  "preprocessor_config.json"
  "processor_config.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "video_preprocessor_config.json"
  "vocab.json"
  "model-00001-of-00005.safetensors"
  "model-00002-of-00005.safetensors"
  "model-00003-of-00005.safetensors"
  "model-00004-of-00005.safetensors"
  "model-00005-of-00005.safetensors"
)

echo "📥 Bắt đầu tải mô hình: orcarouter/Qwen3.8-27B-Uncensored-MLX (6-bit)"
echo "📂 Thư mục đích: $TARGET_DIR"
echo "📦 Tổng cộng: ${#FILES[@]} files (~22.8 GB)"
echo "=================================================================="

for f in "${FILES[@]}"; do
    echo "⬇️ Đang kiểm tra/tải: $f..."
    curl -C - \
         -L \
         --fail \
         --retry 10 \
         --retry-delay 3 \
         --progress-bar \
         -o "$TARGET_DIR/$f" \
         "$BASE_URL/$f"
done

echo "✅ Đã tải xong toàn bộ các file của mô hình MLX 6-bit vào $TARGET_DIR!"

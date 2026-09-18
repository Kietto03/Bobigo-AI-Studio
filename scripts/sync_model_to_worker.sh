#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Sync Qwen 3.8 MLX (21GB) from Host to Worker over Thunderbolt
# Run this on the Worker Mac: bash scripts/sync_model_to_worker.sh
# ==============================================================================
set -euo pipefail

HOST_IP="${HOST_IP:-192.168.100.1}"
TARGET="$HOME/.exo/models/orcarouter--Qwen3.8-27B-Uncensored-MLX"

echo "========================================================"
echo "⚡ Đồng bộ mô hình Qwen 3.8 MLX qua Thunderbolt 40Gbps"
echo "   Nguồn Host: http://$HOST_IP:8888"
echo "   Đích Worker: $TARGET"
echo "========================================================"

mkdir -p "$TARGET"
cd "$TARGET"

FILES=(
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

for f in "${FILES[@]}"; do
    echo "⬇️ Đang đồng bộ: $f..."
    curl -C - -L --fail --progress-bar -o "$f" "http://$HOST_IP:8888/$f"
done

echo ""
echo "🎉 ĐÃ ĐỒNG BỘ XONG 100% MÔ HÌNH VÀO WORKER!"
echo "========================================================"

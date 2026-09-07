#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Sync Draft Model (Qwen 3.5 0.8B) to Worker over Thunderbolt
# Run this on Worker: ./scripts/sync_draft_to_worker.sh
# ==============================================================================
set -euo pipefail

HOST_IP="${HOST_IP:-192.168.100.1}"
BASE_URL="http://${HOST_IP}:8888/Qwen3.5-0.8B-OptiQ-4bit"
TARGET="$HOME/.exo/models/Qwen3.5-0.8B-OptiQ-4bit"

echo "========================================================"
echo "⚡ Đồng bộ mô hình nháp Draft Model (717 MB) sang Worker"
echo "   Nguồn Host: $BASE_URL"
echo "   Đích Worker: $TARGET"
echo "========================================================"

mkdir -p "$TARGET/optiq"
cd "$TARGET"

FILES=(
  "README.md"
  "chat_template.jinja"
  "config.json"
  "generation_config.json"
  "kv_config.json"
  "model.safetensors"
  "model.safetensors.index.json"
  "optiq_metadata.json"
  "tokenizer.json"
  "tokenizer_config.json"
  "optiq/mtp.safetensors"
  "optiq/optiq_vision.safetensors"
)

for f in "${FILES[@]}"; do
    echo "⬇️ Đang tải: $f..."
    curl -C - -L --fail --progress-bar -o "$f" "$BASE_URL/$f"
done

echo ""
echo "🎉 ĐÃ ĐỒNG BỘ XONG 100% DRAFT MODEL TRÊN WORKER!"
echo "========================================================"

#!/bin/bash
# ==============================================================================
# Bobigo AI Studio — llama-server (Metal + --jinja for tool calling)
# ==============================================================================

PORT=11434
MODEL_PATH="${MODEL_PATH:-}"

# 1. Honor MODEL_PATH, else search Ollama cache for a large GGUF blob
if [ -z "$MODEL_PATH" ] || [ ! -f "$MODEL_PATH" ]; then
    FOUND_BLOB=$(find ~/.ollama/models/blobs/ -type f -size +10G 2>/dev/null | head -n 1)
    if [ -n "$FOUND_BLOB" ]; then
        MODEL_PATH="$FOUND_BLOB"
    fi
fi

if [ -n "$MODEL_PATH" ] && [ -f "$MODEL_PATH" ]; then
    echo "🔍 Detected Local Model: $MODEL_PATH"
else
    echo "❌ No GGUF model file found."
    echo "Set MODEL_PATH=/path/to/model.gguf or download: ollama pull qwen3.6-35b"
    exit 1
fi

# 2. Check if llama-server is already running on port 11434
if lsof -i:$PORT >/dev/null 2>&1; then
    echo "✅ llama-server or API process is already running on port $PORT."
    exit 0
fi

# 3. Launch llama-server with Metal GPU acceleration (-ngl 99)
echo "🚀 Starting llama-server on port $PORT with Metal GPU Acceleration..."
exec llama-server \
  -m "$MODEL_PATH" \
  --port $PORT \
  -ngl 99 \
  -c 8192 \
  --host 127.0.0.1 \
  --jinja

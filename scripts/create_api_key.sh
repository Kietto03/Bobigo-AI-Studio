#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — Quick API Key Generator
# Usage: ./scripts/create_api_key.sh "Tên người nhận (vd: Nam Dev, Team Mobile)"
# ==============================================================================
set -euo pipefail

KEY_NAME="${1:-Trial User}"
CUSTOM_KEY="${2:-}"

# Generate random key if custom key not provided
if [ -z "$CUSTOM_KEY" ]; then
    RAND_HEX=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
    KEY="sk-bobigo-${RAND_HEX}"
else
    KEY="$CUSTOM_KEY"
fi

# Insert into Postgres
docker exec bobigo-postgres psql -U bobigo -d bobigo -c "
INSERT INTO api_keys (key, name, user_id)
SELECT '$KEY', '$KEY_NAME', id
FROM users WHERE role='admin' ORDER BY id LIMIT 1;
" >/dev/null 2>&1

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")

echo "========================================================"
echo "✅ ĐÃ TẠO API KEY THÀNH CÔNG CHO: $KEY_NAME"
echo "--------------------------------------------------------"
echo "🔑 API Key:  $KEY"
echo "🌐 Base URL: http://${LAN_IP}:8000/v1"
echo "========================================================"
echo ""
echo "👉 Mẫu gửi cho người dùng:"
echo "--------------------------------------------------------"
echo "Chào bạn, đây là thông tin kết nối Bobigo AI Studio (Dual-Mac Metal GPU):"
echo "- Base URL: http://${LAN_IP}:8000/v1"
echo "- API Key:  $KEY"
echo "- Model:    qwen35b-uncensored"
echo ""
echo "Ví dụ chạy bằng cURL:"
echo "curl http://${LAN_IP}:8000/v1/chat/completions \\"
echo "  -H 'Authorization: Bearer $KEY' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"messages\": [{\"role\": \"user\", \"content\": \"Xin chào!\"}]}'"
echo "--------------------------------------------------------"

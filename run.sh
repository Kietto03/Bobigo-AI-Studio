#!/usr/bin/env bash
# ==============================================================================
# Bobigo AI Studio — High-Performance Studio Launcher 2.0 (Bash / Linux / macOS)
# Interactive GGUF Model Selector & High-Tech Visual Terminal Dashboard
# Usage: ./run.sh [--model <name_or_stt>] [--no-browser] [--help]
# ==============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PYTHON="python3"
if [ -x "$PROJECT_DIR/.venv/bin/python3" ]; then
    PYTHON="$PROJECT_DIR/.venv/bin/python3"
elif [ -x "$PROJECT_DIR/.venv/bin/python" ]; then
    PYTHON="$PROJECT_DIR/.venv/bin/python"
fi

CLI_MODEL=""
NO_BROWSER=0
VISION=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --model|-m)
            CLI_MODEL="$2"
            shift 2
            ;;
        --vision)
            VISION=1
            shift
            ;;
        --no-browser)
            NO_BROWSER=1
            shift
            ;;
        --help|-h)
            echo "Bobigo AI Studio 2.0 — Tham số khởi chạy:"
            echo "  ./run.sh                 Khởi chạy tương tác (chọn model qua menu)"
            echo "  ./run.sh --model <tên>   Chỉ định trực tiếp tên hoặc STT model"
            echo "  ./run.sh --vision        Kích hoạt nạp Multimodal Projector (Vision)"
            echo "  ./run.sh --no-browser    Khởi chạy không tự động mở trình duyệt"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# ANSI Color Definitions
CYAN='\033[0;36m'
DARKCYAN='\033[0;34m'
MAGENTA='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
RED='\033[0;31m'
RESET='\033[0m'

# Cleanup handler
cleanup() {
    echo -e "\n${RED}[DỪNG TIẾN TRÌNH] Đang tắt các dịch vụ Bobigo AI Studio...${RESET}"
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
    fi
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM

<<<<<<< HEAD
# 1. ASCII Art Banner
clear || true
echo ""
echo -e "${CYAN}    ██████╗  ██████╗ ██████╗ ██╗ ██████╗  ██████╗      █████╗ ██╗${RESET}"
echo -e "${CYAN}    ██╔══██╗██╔═══██╗██╔══██╗██║██╔════╝ ██╔═══██╗    ██╔══██╗██║${RESET}"
echo -e "${CYAN}    ██████╔╝██║   ██║██████╔╝██║██║  ███╗██║   ██║    ███████║██║${RESET}"
echo -e "${DARKCYAN}    ██╔══██╗██║   ██║██╔══██╗██║██║   ██║██║   ██║    ██╔══██║██║${RESET}"
echo -e "${DARKCYAN}    ██████╔╝╚██████╔╝██████╔╝██║╚██████╔╝╚██████╔╝    ██║  ██║██║${RESET}"
echo -e "${DARKCYAN}    ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝  ╚═════╝     ╚═╝  ╚═╝╚═╝${RESET}"
echo -e "${MAGENTA}              ✦  S T U D I O   E D I T I O N   2 . 0  ✦${RESET}"
echo ""
echo -e "${GRAY}  ┌───────────────────────────────────────────────────────────────────────────┐${RESET}"
echo -e "${GRAY}  │    Local LLM Studio · Uncensored MoE Agent · 100% Offline & Riêng tư     │${RESET}"
echo -e "${GRAY}  └───────────────────────────────────────────────────────────────────────────┘${RESET}"
echo ""

# 2. Hardware telemetry
RAM_INFO="N/A"
if command -v free >/dev/null 2>&1; then
    RAM_TOTAL=$(free -m | awk '/^Mem:/{printf "%.1f", $2/1024}')
    RAM_AVAIL=$(free -m | awk '/^Mem:/{printf "%.1f", $7/1024}')
    RAM_INFO="${RAM_AVAIL}GB trống / ${RAM_TOTAL}GB"
elif [ "$(uname)" = "Darwin" ]; then
    RAM_TOTAL=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.1f", $1/1073741824}')
    RAM_INFO="${RAM_TOTAL}GB (Apple Silicon / Mac)"
=======
# 0. Start PostgreSQL (Docker) — the app's data store
if docker info >/dev/null 2>&1; then
    echo "🐘 Starting PostgreSQL via Docker Compose..."
    docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d db >/dev/null 2>&1
    echo -n "⏳ Waiting for PostgreSQL..."
    for i in {1..40}; do
        if docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T db pg_isready -U bobigo -d bobigo >/dev/null 2>&1; then
            echo -e "\n✅ PostgreSQL ready."
            break
        fi
        echo -n "."
        sleep 1
    done
else
    echo "⚠️  Docker daemon không chạy — bỏ qua Postgres. App sẽ chạy chế độ offline (IndexedDB cục bộ)."
>>>>>>> origin/main
fi

CORES="8"
if [ "$(uname)" = "Darwin" ]; then
    CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo "8")
else
    CORES=$(nproc 2>/dev/null || echo "8")
fi

GPU_INFO="CPU Threadpool"
if command -v nvidia-smi >/dev/null 2>&1; then
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1)
    if [ -n "$GPU_NAME" ]; then
        GPU_INFO="NVIDIA $GPU_NAME (CUDA)"
    fi
elif [ "$(uname)" = "Darwin" ]; then
    GPU_INFO="Apple Metal GPU (MPS)"
fi

echo -e "  ${YELLOW}[HỆ THỐNG]${RESET} ${GRAY}RAM:${RESET} ${WHITE}${RAM_INFO}${RESET} ${GRAY}│ CPU:${RESET} ${WHITE}${CORES} luồng${RESET} ${GRAY}│ Tăng tốc:${RESET} ${GREEN}${GPU_INFO}${RESET}"
echo ""

# 3. Model Scanning
MODELS_DIR="$PROJECT_DIR/models"
shopt -s nullglob
ALL_MODELS=("$MODELS_DIR"/*.gguf)
shopt -u nullglob

FILTERED_MODELS=()
for m in "${ALL_MODELS[@]}"; do
    base=$(basename "$m")
    if [[ "$base" != mmproj* ]]; then
        FILTERED_MODELS+=("$m")
    fi
done

# Sort models by size
SORTED_MODELS=()
while IFS= read -r line; do
    [ -n "$line" ] && SORTED_MODELS+=("$line")
done < <(for m in "${FILTERED_MODELS[@]}"; do
    [ -f "$m" ] && wc -c < "$m" | awk -v path="$m" '{print $1, path}'
done | sort -n | awk '{$1=""; print substr($0,2)}')

# Check if llama-server is currently active on port 11434
RUNNING_MODEL=""
if curl -sf --max-time 1 http://127.0.0.1:11434/v1/models >/dev/null 2>&1; then
    RUNNING_MODEL=$(curl -s --max-time 1 http://127.0.0.1:11434/v1/models | grep -o '"id":"[^"]*' | head -n 1 | cut -d'"' -f4 || echo "llama-server")
fi

CHOSEN_MODEL=""

if [ -n "$RUNNING_MODEL" ]; then
    activeBase=$(basename "$RUNNING_MODEL")
    echo -e "  ${GREEN}┌───────────────────────────────────────────────────────────────────────────┐${RESET}"
    echo -e "  ${GREEN}│ [ĐANG CHẠY] Llama Server đang hoạt động trên cổng 11434                  │${RESET}"
    printf "  ${GREEN}│ Model: ${CYAN}%-66s${GREEN}│${RESET}\n" "${activeBase:0:63}"
    echo -e "  ${GREEN}└───────────────────────────────────────────────────────────────────────────┘${RESET}"
    echo ""
    echo -e "  ${YELLOW}👉 Bạn muốn thực hiện tác vụ nào?${RESET}"
    echo -e "     ${WHITE}[1] Dùng tiếp model đang chạy (Vào thẳng Web UI — Nhanh nhất)${RESET}"
    echo -e "     ${WHITE}[2] Chọn model khác từ thư mục models/ (Tắt model cũ & nạp mới)${RESET}"
    echo -e "     ${GRAY}[3] Tắt hẳn llama-server hiện tại${RESET}"
    echo ""
    read -r -p "  👉 Nhập lựa chọn [Mặc định: 1]: " actionChoice
    actionChoice=${actionChoice:-1}

    if [ "$actionChoice" = "1" ]; then
        echo -e "  ${GREEN}>> Giữ nguyên mô hình đang chạy, tiến hành mở Studio...${RESET}"
        CHOSEN_MODEL=""
    elif [ "$actionChoice" = "3" ]; then
        echo -e "  ${RED}>> Đang tắt llama-server...${RESET}"
        pkill -f "llama-server" 2>/dev/null || true
        echo -e "  ${GREEN}✔ Đã tắt llama-server thành công.${RESET}"
        exit 0
    else
        echo -e "  ${YELLOW}>> Đang tắt llama-server cũ để chọn mô hình mới...${RESET}"
        pkill -f "llama-server" 2>/dev/null || true
        sleep 1
        RUNNING_MODEL=""
    fi
fi

<<<<<<< HEAD
format_display_name() {
    local name="$1"
    local max=36
    if [ ${#name} -le $max ]; then
        printf "%-36s" "$name"
    else
        local head="${name:0:18}"
        local tail="${name: -15}"
        printf "%-36s" "${head}...${tail}"
    fi
}
=======
# 2. Start Web UI Server on port 8000
echo "🌐 Starting Web UI server on port 8000 (0.0.0.0)..."
"$PYTHON" "$PROJECT_DIR/server.py" &
SERVER_PID=$!
>>>>>>> origin/main

get_recommendation() {
    local name="$1"
    local size_gb="$2"
    if [[ "$name" == *"Q4_K_P"* ]]; then
        echo "[★] Khuyên Dùng"
    elif [[ "$name" == *"Q4_K_M"* ]]; then
        echo "Tốt (Chuẩn MoE)"
    elif (( $(echo "$size_gb < 14.0" | bc -l 2>/dev/null || echo 0) )); then
        echo "Siêu nhẹ (16GB)"
    elif (( $(echo "$size_gb < 20.0" | bc -l 2>/dev/null || echo 0) )); then
        echo "Cân bằng (24GB)"
    elif (( $(echo "$size_gb > 35.0" | bc -l 2>/dev/null || echo 0) )); then
        echo "Rất nặng (48GB+)"
    else
        echo "Nặng (RAM 32GB+)"
    fi
}

<<<<<<< HEAD
if [ -z "$RUNNING_MODEL" ]; then
    TOTAL_COUNT=${#SORTED_MODELS[@]}
    if [ "$TOTAL_COUNT" -eq 0 ]; then
        echo -e "  ${RED}[CẢNH BÁO] Không tìm thấy file mô hình (.gguf) nào trong $MODELS_DIR!${RESET}"
    else
        # Find default Q4_K_P index
        DEFAULT_IDX=1
        for i in "${!SORTED_MODELS[@]}"; do
            base=$(basename "${SORTED_MODELS[$i]}")
            if [[ "$base" == *"Q4_K_P"* ]]; then
                DEFAULT_IDX=$((i + 1))
                break
            fi
        done

        if [ -n "$CLI_MODEL" ]; then
            if [[ "$CLI_MODEL" =~ ^[0-9]+$ ]] && [ "$CLI_MODEL" -ge 1 ] && [ "$CLI_MODEL" -le "$TOTAL_COUNT" ]; then
                CHOSEN_MODEL="${SORTED_MODELS[$((CLI_MODEL - 1))]}"
            else
                for m in "${SORTED_MODELS[@]}"; do
                    if [[ "$(basename "$m")" == *"$CLI_MODEL"* ]]; then
                        CHOSEN_MODEL="$m"
                        break
                    fi
                done
            fi
        fi

        if [ -z "$CHOSEN_MODEL" ]; then
            echo -e "  ${DARKCYAN}┌───────────────────────────────────────────────────────────────────────────┐${RESET}"
            echo -e "  ${DARKCYAN}│                         ${CYAN}DANH SÁCH MÔ HÌNH HIỆN CÓ                         ${DARKCYAN}│${RESET}"
            echo -e "  ${DARKCYAN}├────┬──────────────────────────────────────┬────────────┬──────────────────┤${RESET}"
            echo -e "  ${DARKCYAN}│ STT│ TÊN MÔ HÌNH                          │ DUNG LƯỢNG │ ĐÁNH GIÁ / GỢI Ý │${RESET}"
            echo -e "  ${DARKCYAN}├────┼──────────────────────────────────────┼────────────┼──────────────────┤${RESET}"

            for i in "${!SORTED_MODELS[@]}"; do
                m="${SORTED_MODELS[$i]}"
                base=$(basename "$m")
                stt=$(printf "%02d" $((i + 1)))
                size_bytes=$(wc -c < "$m" 2>/dev/null || echo 0)
                size_gb=$(awk "BEGIN {printf \"%.2f\", $size_bytes / 1073741824}")
                disp=$(format_display_name "$base")
                rec=$(get_recommendation "$base" "$size_gb")
                size_str=$(printf "%7.2f GB" "$size_gb")

                if [ $((i + 1)) -eq "$DEFAULT_IDX" ]; then
                    printf "  ${DARKCYAN}│${YELLOW}[%s]${DARKCYAN}│ %s │ %s │ ${GREEN}%-16s${DARKCYAN}│${RESET}\n" "$stt" "$disp" "$size_str" "$rec"
                else
                    printf "  ${DARKCYAN}│${GRAY} %s ${DARKCYAN}│${GRAY} %s ${DARKCYAN}│${GRAY} %s ${DARKCYAN}│${GRAY} %-16s${DARKCYAN}│${RESET}\n" "$stt" "$disp" "$size_str" "$rec"
                fi
            done

            echo -e "  ${DARKCYAN}├────┴──────────────────────────────────────┴────────────┴──────────────────┤${RESET}"
            echo -e "  ${DARKCYAN}│ ${GRAY}[00] Bỏ qua nạp model (Chỉ mở Web UI Studio)                             ${DARKCYAN}│${RESET}"
            echo -e "  ${DARKCYAN}└───────────────────────────────────────────────────────────────────────────┘${RESET}"
            echo ""

            defaultStt=$(printf "%02d" "$DEFAULT_IDX")
            read -r -p "  👉 Chọn mô hình [01-$(printf "%02d" "$TOTAL_COUNT"), Enter = Mặc định [$defaultStt]]: " userChoice
            userChoice=${userChoice:-$DEFAULT_IDX}

            if [ "$userChoice" = "0" ] || [ "$userChoice" = "00" ]; then
                echo -e "  ${YELLOW}>> Bỏ qua nạp model, tiến hành mở Web UI Studio...${RESET}"
                CHOSEN_MODEL=""
            elif [[ "$userChoice" =~ ^[0-9]+$ ]] && [ "$userChoice" -ge 1 ] && [ "$userChoice" -le "$TOTAL_COUNT" ]; then
                CHOSEN_MODEL="${SORTED_MODELS[$((userChoice - 1))]}"
            else
                for m in "${SORTED_MODELS[@]}"; do
                    if [[ "$(basename "$m")" == *"$userChoice"* ]]; then
                        CHOSEN_MODEL="$m"
                        break
                    fi
                done
                if [ -z "$CHOSEN_MODEL" ]; then
                    echo -e "  ${YELLOW}>> Lựa chọn không hợp lệ, dùng mô hình mặc định [$defaultStt].${RESET}"
                    CHOSEN_MODEL="${SORTED_MODELS[$((DEFAULT_IDX - 1))]}"
                fi
            fi
        fi

        # Launch llama-server with selected model
        if [ -n "$CHOSEN_MODEL" ]; then
            model_base=$(basename "$CHOSEN_MODEL")
            model_lower=$(echo "$model_base" | tr '[:upper:]' '[:lower:]')

            NGL="24"
            if [[ "$model_lower" == *"a3b"* ]] || [[ "$model_lower" == *"moe"* ]]; then
                if [[ "$model_lower" == *"iq2_m"* ]]; then
                    NGL="40"
                elif [[ "$model_lower" == *"iq3_m"* ]] || [[ "$model_lower" == *"q2_k"* ]]; then
                    NGL="26"
                elif [[ "$model_lower" == *"iq4_xs"* ]] || [[ "$model_lower" == *"q3_k"* ]]; then
                    NGL="20"
                elif [[ "$model_lower" == *"iq4_nl"* ]] || [[ "$model_lower" == *"q4_k_m"* ]]; then
                    NGL="18"
                elif [[ "$model_lower" == *"q4_k_p"* ]]; then
                    NGL="16"
                else
                    NGL="16"
                fi
            elif [[ "$model_lower" == *"qwen3.8"* ]]; then
                NGL="18"
            elif [[ "$model_lower" == *"qwen3.6"* ]] || [[ "$model_lower" == *"35b"* ]]; then
                NGL="28"
            fi
            NGL="${LLM_NGL:-$NGL}"
            CTX="${CONTEXT_WINDOW:-16384}"
            THREADS=$(( CORES > 8 ? 8 : (CORES > 4 ? CORES : 4) ))

            echo ""
            echo -e "  ${CYAN}┌───────────────────────────────────────────────────────────────────────────┐${RESET}"
            printf "  ${CYAN}│ [NẠP MÔ HÌNH] ${GREEN}%-60s${CYAN}│${RESET}\n" "$model_base"
            echo -e "  ${CYAN}│ Context: $CTX · GPU Offload: $NGL tầng · Cổng: 11434                    │${RESET}"
            echo -e "  ${CYAN}└───────────────────────────────────────────────────────────────────────────┘${RESET}"

            LLAMA_BIN="llama-server"
            if [ -x "$PROJECT_DIR/bin/llama-server" ]; then
                LLAMA_BIN="$PROJECT_DIR/bin/llama-server"
            fi

            MMPROJ_ARGS=()
            shopt -s nullglob
            MMPROJS=("$MODELS_DIR"/mmproj*.gguf)
            shopt -u nullglob
            if [ ${#MMPROJS[@]} -gt 0 ]; then
                if [ "$VISION" -eq 1 ] || [ "$BOBIGO_VISION" = "1" ]; then
                    MMPROJ_ARGS=("--mmproj" "${MMPROJS[0]}")
                    echo -e "  ${MAGENTA}[VISION] Đã tích hợp Multimodal Vision: $(basename "${MMPROJS[0]}")${RESET}"
                else
                    echo -e "  ${DARKCYAN}[VISION] Bỏ qua Multimodal Projector để tiết kiệm VRAM (dùng --vision khi cần).${RESET}"
                fi
            fi

            CMD=(
                "$LLAMA_BIN"
                "-m" "$CHOSEN_MODEL"
                "--port" "11434"
                "-ngl" "$NGL"
                "-fa" "on"
                "-c" "$CTX"
                "-np" "1"
                "-t" "$THREADS"
                "-tb" "$THREADS"
                "--host" "0.0.0.0"
                "--jinja"
                "-ctk" "q4_0"
                "-ctv" "q4_0"
                "--log-file" "$PROJECT_DIR/backend.log"
            )
            [ "$LLAMA_CPU_MOE" = "1" ] && CMD+=("--cpu-moe")
            [ ${#MMPROJ_ARGS[@]} -gt 0 ] && CMD+=("${MMPROJ_ARGS[@]}")

            "${CMD[@]}" >/dev/null 2>&1 &
            BACKEND_PID=$!

            # Loading spinner
            spinChars=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
            READY=0
            START_TIME=$(date +%s)
            echo ""
            for (( i=0; i<180; i++ )); do
                if curl -sf --max-time 1 http://127.0.0.1:11434/v1/models >/dev/null 2>&1; then
                    READY=1
                    break
                fi
                ELAPSED=$(( $(date +%s) - START_TIME ))
                CHAR="${spinChars[$((i % 10))]}"
                printf "\r  ${CYAN}%s Đang nạp mô hình vào RAM/VRAM... (%ds) ${RESET}" "$CHAR" "$ELAPSED"
                sleep 0.5
            done

            if [ "$READY" -eq 1 ]; then
                ELAPSED=$(( $(date +%s) - START_TIME ))
                printf "\r  ${GREEN}✔ Mô hình đã nạp thành công vào RAM/VRAM (%ds)!            ${RESET}\n" "$ELAPSED"
            else
                printf "\r  ${YELLOW}⚠ Mô hình mất nhiều thời gian nạp hơn dự kiến (kiểm tra backend.log).${RESET}\n"
            fi
        fi
    fi
fi

# 4. Open Browser
if [ "$NO_BROWSER" -eq 0 ]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:8000" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
        open "http://localhost:8000" >/dev/null 2>&1 &
    fi
fi

# 5. Dashboard Card
DISPLAY_MODEL="Chưa kết nối"
if [ -n "$CHOSEN_MODEL" ]; then
    DISPLAY_MODEL=$(basename "$CHOSEN_MODEL")
elif [ -n "$RUNNING_MODEL" ]; then
    DISPLAY_MODEL=$(basename "$RUNNING_MODEL")
fi

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ifconfig 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)

echo ""
echo -e "  ${GREEN}╔═══════════════════════════════════════════════════════════════════════════╗${RESET}"
echo -e "  ${GREEN}║               ✦  BOBIGO AI STUDIO 2.0 ĐÃ SẴN SÀNG  ✦                     ║${RESET}"
echo -e "  ${GREEN}╠═══════════════════════════════════════════════════════════════════════════╣${RESET}"
echo -e "  ${GREEN}║  🌐 Web Studio:     ${WHITE}http://localhost:8000                                 ${GREEN}║${RESET}"
if [ -n "$LAN_IP" ]; then
printf "  ${GREEN}║  🌐 LAN Studio:     ${WHITE}http://%-47s${GREEN}║${RESET}\n" "$LAN_IP:8000"
fi
echo -e "  ${GREEN}║  🤖 LLM Engine:     ${WHITE}http://127.0.0.1:11434 (OpenAI Compatible)            ${GREEN}║${RESET}"
printf "  ${GREEN}║  🧠 Active Model:   ${CYAN}%-54s${GREEN}║${RESET}\n" "${DISPLAY_MODEL:0:50}"
echo -e "  ${GREEN}║  ⌨ Điều khiển:      ${YELLOW}Nhấn [Ctrl + C] để dừng toàn bộ an toàn                 ${GREEN}║${RESET}"
echo -e "  ${GREEN}╚═══════════════════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# 6. Run FastAPI Server
"$PYTHON" "$PROJECT_DIR/server.py"

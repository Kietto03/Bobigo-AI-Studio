# ==============================================================================
# Bobigo AI Studio - High-Performance Studio Launcher 2.0
# Giao diện điều khiển cao cấp & Menu lựa chọn mô hình GGUF thông minh
# Usage: .\run.ps1 [-Model <tên_hoặc_stt>] [-NoBrowser] [-Help]
# ==============================================================================

param(
    [string]$Model = "",
    [switch]$NoBrowser = $false,
    [switch]$Vision = $false,
    [switch]$Help = $false
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Bobigo AI Studio 2.0 - Local LLM Agent"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

if ($Help) {
    Write-Host ""
    Write-Host "Bobigo AI Studio 2.0 - Hướng dẫn tham số dòng lệnh:" -ForegroundColor Cyan
    Write-Host "  .\run.ps1                 Khởi chạy tương tác (chọn model bằng menu thông minh)"
    Write-Host "  .\run.ps1 -Model <tên>    Chỉ định trực tiếp model (vd: -Model IQ3_M hoặc -Model 8)"
    Write-Host "  .\run.ps1 -Vision         Kích hoạt nạp Multimodal Projector (Vision) cho ảnh"
    Write-Host "  .\run.ps1 -NoBrowser      Khởi chạy không tự động mở trình duyệt"
    Write-Host "  .\run.ps1 -Help           Hiển thị trợ giúp này"
    Write-Host ""
    exit 0
}

$Python = "python"
if (Test-Path "$ScriptDir\.venv\Scripts\python.exe") {
    $Python = "$ScriptDir\.venv\Scripts\python.exe"
}

# --- 1. Hiển thị Banner Phong Cách Cyberpunk Studio ---
function Show-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "    ██████╗  ██████╗ ██████╗ ██╗ ██████╗  ██████╗      █████╗ ██╗" -ForegroundColor Cyan
    Write-Host "    ██╔══██╗██╔═══██╗██╔══██╗██║██╔════╝ ██╔═══██╗    ██╔══██╗██║" -ForegroundColor Cyan
    Write-Host "    ██████╔╝██║   ██║██████╔╝██║██║  ███╗██║   ██║    ███████║██║" -ForegroundColor Cyan
    Write-Host "    ██╔══██╗██║   ██║██╔══██╗██║██║   ██║██║   ██║    ██╔══██║██║" -ForegroundColor DarkCyan
    Write-Host "    ██████╔╝╚██████╔╝██████╔╝██║╚██████╔╝╚██████╔╝    ██║  ██║██║" -ForegroundColor DarkCyan
    Write-Host "    ╚═════╝  ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝  ╚═════╝     ╚═╝  ╚═╝╚═╝" -ForegroundColor DarkCyan
    Write-Host "              ✦  S T U D I O   E D I T I O N   2 . 0  ✦" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  ┌───────────────────────────────────────────────────────────────────────────┐" -ForegroundColor DarkGray
    Write-Host "  │    Local LLM Studio · Uncensored MoE Agent · 100% Offline & Riêng tư     │" -ForegroundColor Gray
    Write-Host "  └───────────────────────────────────────────────────────────────────────────┘" -ForegroundColor DarkGray
    Write-Host ""
}

# --- 2. Chuẩn đoán & Hiển thị thông số phần cứng ---
$script:DetectedVramMb = 0
$script:PhysicalCores = 8

function Show-SystemInfo {
    $GpuInfo = "CPU Threadpool"
    try {
        $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
        if ($smi) {
            $gpuOut = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null
            if ($gpuOut) {
                $firstGpuLine = ($gpuOut -split "`n")[0].Trim()
                $parts = $firstGpuLine -split ","
                if ($parts.Count -ge 2) {
                    $script:DetectedVramMb = [int]($parts[1].Trim())
                    $vramGb = [Math]::Round($script:DetectedVramMb / 1024, 1)
                    $GpuInfo = "NVIDIA " + $parts[0].Trim() + " (" + $vramGb + "GB VRAM, CUDA)"
                } else {
                    $GpuInfo = "NVIDIA " + $firstGpuLine + " (CUDA)"
                }
            }
        }
    } catch {}

    $RamTotalGb = 0
    $RamFreeGb = 0
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os) {
            $RamTotalGb = [Math]::Round($os.TotalVisibleMemorySize / (1024 * 1024), 1)
            $RamFreeGb = [Math]::Round($os.FreePhysicalMemory / (1024 * 1024), 1)
        }
    } catch {}

    try {
        $pCores = (Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue).NumberOfCores
        if ($pCores -and $pCores -gt 0) {
            $script:PhysicalCores = $pCores
        }
    } catch {}

    $Cores = $env:NUMBER_OF_PROCESSORS
    if (-not $Cores) { $Cores = "8" }

    Write-Host "  [HỆ THỐNG]" -ForegroundColor Yellow -NoNewline
    Write-Host " RAM: " -ForegroundColor DarkGray -NoNewline
    Write-Host "${RamFreeGb}GB trống / ${RamTotalGb}GB" -ForegroundColor White -NoNewline
    Write-Host " │ CPU: " -ForegroundColor DarkGray -NoNewline
    Write-Host "$($script:PhysicalCores)P/$Cores luồng" -ForegroundColor White -NoNewline
    Write-Host " │ Tăng tốc: " -ForegroundColor DarkGray -NoNewline
    Write-Host "$GpuInfo" -ForegroundColor Green
    Write-Host ""
}

Show-Banner
Show-SystemInfo

$LlamaServer = "$ScriptDir\bin\llama-server.exe"
$LlmUrl = "http://127.0.0.1:11434/v1/models"
$ModelsDir = "$ScriptDir\models"
$StartedLlama = $false

# --- 3. Quét danh sách mô hình GGUF trong thư mục models/ ---
$AvailableModels = @()
if (Test-Path $ModelsDir) {
    $AvailableModels = Get-ChildItem -Path $ModelsDir -Filter "*.gguf" -ErrorAction SilentlyContinue |
                       Where-Object { $_.Name -notlike "mmproj*.gguf" } |
                       Sort-Object Length
}

# --- 4. Kiểm tra xem llama-server có đang chạy sẵn không ---
$ActiveRunningModel = $null
try {
    $resp = Invoke-RestMethod -Uri $LlmUrl -TimeoutSec 2 -ErrorAction Stop
    if ($resp -and $resp.data -and $resp.data.Count -gt 0) {
        $ActiveRunningModel = $resp.data[0].id
    }
} catch {
    $ActiveRunningModel = $null
}

$ChosenModelFile = $null

if ($ActiveRunningModel) {
    $activeBaseName = [System.IO.Path]::GetFileName($ActiveRunningModel)
    Write-Host "  ┌───────────────────────────────────────────────────────────────────────────┐" -ForegroundColor Green
    Write-Host "  │ [ĐANG CHẠY] Llama Server đang hoạt động trên cổng 11434                  │" -ForegroundColor Green
    Write-Host "  │ Model: " -ForegroundColor Green -NoNewline
    
    $truncActive = $activeBaseName
    if ($truncActive.Length -gt 63) {
        $truncActive = $truncActive.Substring(0, 60) + "..."
    }
    Write-Host "$($truncActive.PadRight(66))│" -ForegroundColor Cyan
    Write-Host "  └───────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Green
    Write-Host ""
    Write-Host "  👉 Bạn muốn thực hiện tác vụ nào?" -ForegroundColor Yellow
    Write-Host "     [1] Dùng tiếp model đang chạy (Vào thẳng Web UI - Nhanh nhất)" -ForegroundColor White
    Write-Host "     [2] Chọn model khác từ thư mục models/ (Tắt model cũ & nạp mới)" -ForegroundColor White
    Write-Host "     [3] Tắt hẳn llama-server hiện tại" -ForegroundColor DarkGray
    Write-Host ""
    
    $actionChoice = Read-Host "  👉 Nhập lựa chọn [Mặc định: 1]"
    if (-not $actionChoice -or $actionChoice.Trim() -eq "") { $actionChoice = "1" }

    if ($actionChoice.Trim() -eq "1") {
        Write-Host "  >> Giữ nguyên mô hình đang chạy, tiến hành mở Studio..." -ForegroundColor Green
        $StartedLlama = $false
    } elseif ($actionChoice.Trim() -eq "3") {
        Write-Host "  >> Đang dừng llama-server..." -ForegroundColor Red
        Get-Process "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
        Write-Host "  ✔ Đã tắt llama-server thành công." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "  >> Đang tắt llama-server cũ để chọn mô hình mới..." -ForegroundColor Yellow
        Get-Process "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
        $ActiveRunningModel = $null
    }
}

# Định dạng hiển thị tên mô hình: Giữ đầu và đuôi để luôn thấy Quantization
function Format-ModelDisplayName([string]$name, [int]$maxLength = 36) {
    if ($name.Length -le $maxLength) {
        return $name.PadRight($maxLength)
    }
    $head = $name.Substring(0, 18)
    $tail = $name.Substring($name.Length - 15)
    return ("{0}...{1}" -f $head, $tail).PadRight($maxLength)
}

# Tính toán số tầng offload GPU tối ưu dựa trên model và VRAM thực tế
function Get-OptimalNgl([string]$modelName, [int]$vramMb) {
    if ($env:LLM_NGL) { return $env:LLM_NGL }
    if ($vramMb -le 0) { return "0" }

    $nameLower = $modelName.ToLower()
    $isMoe = ($nameLower -like "*a3b*" -or $nameLower -like "*moe*")

    if ($isMoe) {
        if ($nameLower -like "*iq2_m*") {
            if ($vramMb -ge 11000) { return "40" } # 100% tầng trên GPU
            elseif ($vramMb -ge 8000) { return "28" }
            else { return "18" }
        }
        elseif ($nameLower -like "*iq3_m*" -or $nameLower -like "*q2_k*") {
            if ($vramMb -ge 22000) { return "40" }
            elseif ($vramMb -ge 15000) { return "34" }
            elseif ($vramMb -ge 11000) { return "26" } # ~9.1GB VRAM, hoàn hảo cho card 12GB
            elseif ($vramMb -ge 8000) { return "18" }
            else { return "12" }
        }
        elseif ($nameLower -like "*iq4_xs*" -or $nameLower -like "*q3_k*") {
            if ($vramMb -ge 24000) { return "40" }
            elseif ($vramMb -ge 15000) { return "30" }
            elseif ($vramMb -ge 11000) { return "20" }
            else { return "14" }
        }
        elseif ($nameLower -like "*iq4_nl*" -or $nameLower -like "*q4_k_m*") {
            if ($vramMb -ge 24000) { return "40" }
            elseif ($vramMb -ge 15000) { return "26" }
            elseif ($vramMb -ge 11000) { return "18" }
            else { return "12" }
        }
        elseif ($nameLower -like "*q4_k_p*") {
            if ($vramMb -ge 24000) { return "40" }
            elseif ($vramMb -ge 15000) { return "24" }
            elseif ($vramMb -ge 11000) { return "16" } # ~9.7GB VRAM, giữ RAM an toàn
            else { return "10" }
        }
        elseif ($nameLower -like "*q5_k*") {
            if ($vramMb -ge 24000) { return "34" }
            elseif ($vramMb -ge 11000) { return "14" }
            else { return "8" }
        }
        elseif ($nameLower -like "*q6_k*") {
            if ($vramMb -ge 24000) { return "28" }
            elseif ($vramMb -ge 11000) { return "12" }
            else { return "6" }
        }
        elseif ($nameLower -like "*q8_k*") {
            if ($vramMb -ge 24000) { return "20" }
            elseif ($vramMb -ge 11000) { return "8" }
            else { return "4" }
        }
        return "16"
    } else {
        if ($nameLower -like "*qwen3.8*") { return "18" }
        elseif ($nameLower -like "*35b*" -or $nameLower -like "*qwen3.6*") { return "28" }
        return "24"
    }
}

# Đánh giá & Gợi ý dung lượng RAM / VRAM theo phần cứng thực tế
function Get-ModelRecommendation([string]$name, [double]$sizeGb, [int]$vramMb) {
    $raw = ""
    if ($vramMb -ge 10000 -and $vramMb -le 15000) {
        # Card 12GB VRAM (RTX 3080 Ti, 3060, 4070...)
        if ($name -like "*IQ2_M*.gguf") {
            $raw = "[⚡] Tối Đa Tốc Độ (100% VRAM)"
        } elseif ($name -like "*IQ3_M*.gguf") {
            $raw = "[★] Khuyên Dùng (Cân Bằng)"
        } elseif ($name -like "*IQ4_XS*.gguf") {
            $raw = "Chất lượng cao (Cân bằng)"
        } elseif ($name -like "*Q4_K_P*.gguf") {
            $raw = "Nặng (Offload 16 tầng)"
        } elseif ($name -like "*Q8_K_P*.gguf") {
            $raw = "Rất nặng (32GB+ RAM)"
        } elseif ($sizeGb -lt 14.0) {
            $raw = "Siêu nhẹ (100% VRAM)"
        } else {
            $raw = "Tiêu chuẩn"
        }
    } elseif ($vramMb -ge 20000) {
        if ($name -like "*Q4_K_P*.gguf") {
            $raw = "[★] Khuyên Dùng (Vừa VRAM)"
        } elseif ($name -like "*IQ3_M*.gguf") {
            $raw = "Siêu nhanh"
        } else {
            $raw = "Tốt"
        }
    } else {
        if ($name -like "*IQ2_M*.gguf") {
            $raw = "[★] Khuyên Dùng (Nhẹ)"
        } elseif ($name -like "*IQ3_M*.gguf") {
            $raw = "Cân bằng"
        } else {
            $raw = "Nặng"
        }
    }
    return $raw.PadRight(28)
}

# --- 5. Bảng lựa chọn mô hình tương tác ---
if (-not $ActiveRunningModel) {
    if ($AvailableModels.Count -eq 0) {
        Write-Host "  [CẢNH BÁO] Không tìm thấy file mô hình (.gguf) nào trong $ModelsDir!" -ForegroundColor Red
        Write-Host "  Vui lòng tải model GGUF đặt vào thư mục models/ rồi chạy lại." -ForegroundColor Yellow
        Write-Host ""
    } else {
        # Tìm số thứ tự của model khuyên dùng mặc định phù hợp với VRAM
        $defaultIndex = 1
        $targetPref = if ($script:DetectedVramMb -ge 20000) { "*Q4_K_P*.gguf" }
                      elseif ($script:DetectedVramMb -ge 10000) { "*IQ3_M*.gguf" }
                      else { "*IQ2_M*.gguf" }

        for ($i = 0; $i -lt $AvailableModels.Count; $i++) {
            if ($AvailableModels[$i].Name -like $targetPref) {
                $defaultIndex = $i + 1
                break
            }
        }
        # Nếu không tìm thấy targetPref, tìm IQ2_M hoặc Q4_K_P
        if ($defaultIndex -eq 1 -and -not ($AvailableModels[0].Name -like $targetPref)) {
            for ($i = 0; $i -lt $AvailableModels.Count; $i++) {
                if ($AvailableModels[$i].Name -like "*IQ2_M*.gguf" -or $AvailableModels[$i].Name -like "*Q4_K_P*.gguf") {
                    $defaultIndex = $i + 1
                    break
                }
            }
        }

        # Nếu có tham số dòng lệnh -Model
        if ($Model) {
            $parsedCliIdx = 0
            if ([int]::TryParse($Model.Trim(), [ref]$parsedCliIdx) -and $parsedCliIdx -ge 1 -and $parsedCliIdx -le $AvailableModels.Count) {
                $ChosenModelFile = $AvailableModels[$parsedCliIdx - 1]
            } else {
                $ChosenModelFile = $AvailableModels | Where-Object { $_.Name -like "*$Model*" } | Select-Object -First 1
            }
        }

        # Hiển thị Menu bảng nếu chưa chọn qua CLI
        if (-not $ChosenModelFile) {
            Write-Host "  ┌─────────────────────────────────────────────────────────────────────────────────────────┐" -ForegroundColor DarkCyan
            Write-Host "  │                                DANH SÁCH MÔ HÌNH HIỆN CÓ                                │" -ForegroundColor Cyan
            Write-Host "  ├────┬──────────────────────────────────────┬────────────┬────────────────────────────────┤" -ForegroundColor DarkCyan
            Write-Host "  │ STT│ TÊN MÔ HÌNH                          │ DUNG LƯỢNG │ ĐÁNH GIÁ / GỢI Ý PHẦN CỨNG     │" -ForegroundColor DarkCyan
            Write-Host "  ├────┼──────────────────────────────────────┼────────────┼────────────────────────────────┤" -ForegroundColor DarkCyan

            for ($i = 0; $i -lt $AvailableModels.Count; $i++) {
                $m = $AvailableModels[$i]
                $sizeGb = [Math]::Round($m.Length / 1GB, 2)
                $stt = ($i + 1).ToString().PadLeft(2, '0')
                $disp = Format-ModelDisplayName $m.Name 36
                $sizeStr = ("{0:N2} GB" -f $sizeGb).PadLeft(10)
                $rec = Get-ModelRecommendation $m.Name $sizeGb $script:DetectedVramMb

                if ($i + 1 -eq $defaultIndex) {
                    Write-Host "  │" -ForegroundColor DarkCyan -NoNewline
                    Write-Host "[$stt]" -ForegroundColor Yellow -NoNewline
                    Write-Host "│ $disp │ $sizeStr │ " -ForegroundColor White -NoNewline
                    Write-Host "$rec" -ForegroundColor Green -NoNewline
                    Write-Host "│" -ForegroundColor DarkCyan
                } else {
                    Write-Host "  │ $stt │ $disp │ $sizeStr │ $rec │" -ForegroundColor Gray
                }
            }

            Write-Host "  ├────┴──────────────────────────────────────┴────────────┴────────────────────────────────┤" -ForegroundColor DarkCyan
            Write-Host "  │ [00] Bỏ qua nạp model (Chỉ mở Web UI Studio)                                           │" -ForegroundColor DarkGray
            Write-Host "  └─────────────────────────────────────────────────────────────────────────────────────────┘" -ForegroundColor DarkCyan
            Write-Host ""

            $defaultSttStr = $defaultIndex.ToString().PadLeft(2, '0')
            $prompt = "  👉 Chọn mô hình [01-$($AvailableModels.Count.ToString().PadLeft(2, '0')), Enter = Mặc định [$defaultSttStr]]: "
            $userChoice = Read-Host $prompt

            if (-not $userChoice -or $userChoice.Trim() -eq "") {
                $ChosenModelFile = $AvailableModels[$defaultIndex - 1]
            } elseif ($userChoice.Trim() -eq "0" -or $userChoice.Trim() -eq "00") {
                Write-Host "  >> Bỏ qua nạp model, tiến hành mở Web UI Studio..." -ForegroundColor Yellow
                $ChosenModelFile = $null
            } else {
                $parsedIdx = 0
                if ([int]::TryParse($userChoice.Trim(), [ref]$parsedIdx) -and $parsedIdx -ge 1 -and $parsedIdx -le $AvailableModels.Count) {
                    $ChosenModelFile = $AvailableModels[$parsedIdx - 1]
                } else {
                    $matchByName = $AvailableModels | Where-Object { $_.Name -like "*$($userChoice.Trim())*" } | Select-Object -First 1
                    if ($matchByName) {
                        $ChosenModelFile = $matchByName
                    } else {
                        Write-Host "  >> Lựa chọn không hợp lệ, dùng mô hình mặc định [$defaultSttStr]." -ForegroundColor Yellow
                        $ChosenModelFile = $AvailableModels[$defaultIndex - 1]
                    }
                }
            }
        }

        # --- 6. Khởi động llama-server với mô hình đã chọn ---
        if ($ChosenModelFile) {
            $optNgl = Get-OptimalNgl $ChosenModelFile.Name $script:DetectedVramMb
            $CtxWindow = if ($env:CONTEXT_WINDOW) { $env:CONTEXT_WINDOW } else { "16384" }
            $genThreads = [Math]::Min([Math]::Max($script:PhysicalCores, 4), 8)
            $batchThreads = [Math]::Min([Math]::Max($script:PhysicalCores, 4), 8)

            Write-Host ""
            Write-Host "  ┌───────────────────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
            Write-Host "  │ [NẠP MÔ HÌNH] " -ForegroundColor Cyan -NoNewline
            Write-Host "$($ChosenModelFile.Name)" -ForegroundColor Green
            Write-Host "  │ Dung lượng: $([Math]::Round($ChosenModelFile.Length / 1GB, 2)) GB · Context: $CtxWindow · GPU Offload: $optNgl tầng" -ForegroundColor Gray
            Write-Host "  └───────────────────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan

            $env:DEFAULT_MODEL = $ChosenModelFile.Name

            $LogFile = "$ScriptDir\backend.log"
            $LlamaArgs = @(
                "-m", $ChosenModelFile.FullName,
                "--port", "11434",
                "-ngl", "$optNgl",
                "-fa", "on",
                "-c", "$CtxWindow",
                "-np", "1",
                "-t", "$genThreads",
                "-tb", "$batchThreads",
                "--host", "0.0.0.0",
                "--jinja",
                "-ctk", "q4_0",
                "-ctv", "q4_0",
                "--log-file", $LogFile
            )

            # Cờ MoE chỉ bật nếu người dùng chủ động yêu cầu qua biến môi trường
            if ($env:LLAMA_CPU_MOE -eq "1") {
                $LlamaArgs += @("--cpu-moe")
                Write-Host "  [CẢNH BÁO] Ép chạy MoE trên CPU (LLAMA_CPU_MOE=1) - Tốc độ có thể bị giảm!" -ForegroundColor Yellow
            }

            # Kiểm tra Multimodal Projector (mmproj) cho Vision
            $Mmproj = Get-ChildItem -Path $ModelsDir -Filter "mmproj*.gguf" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($Mmproj) {
                if ($Vision -or $env:BOBIGO_VISION -eq "1") {
                    $LlamaArgs += @("--mmproj", $Mmproj.FullName)
                    Write-Host "  [VISION] Đã tích hợp Multimodal Vision: $($Mmproj.Name)" -ForegroundColor Magenta
                } else {
                    Write-Host "  [VISION] Bỏ qua nạp Multimodal Projector để tiết kiệm 900MB VRAM (dùng .\run.ps1 -Vision khi cần)." -ForegroundColor DarkGray
                }
            }

            Start-Process -FilePath $LlamaServer -ArgumentList $LlamaArgs -WorkingDirectory "$ScriptDir\bin"
            $StartedLlama = $true

            # Hiệu ứng Spinner thời gian thực trong khi nạp mô hình vào RAM/VRAM
            $spinChars = @("⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏")
            $spinIdx = 0
            $isReady = $false
            $timeoutSeconds = 120
            $startTime = Get-Date

            Write-Host ""
            while (((Get-Date) - $startTime).TotalSeconds -lt $timeoutSeconds) {
                try {
                    $probe = Invoke-RestMethod -Uri $LlmUrl -TimeoutSec 1 -ErrorAction Stop
                    if ($probe) {
                        $isReady = $true
                        break
                    }
                } catch {}

                $elapsed = [Math]::Round(((Get-Date) - $startTime).TotalSeconds)
                $char = $spinChars[$spinIdx % $spinChars.Count]
                Write-Host -NoNewline "`r  $char Đang nạp mô hình vào RAM/VRAM... (${elapsed}s) " -ForegroundColor Cyan
                $spinIdx++
                Start-Sleep -Milliseconds 250
            }

            if ($isReady) {
                $totalSec = [Math]::Round(((Get-Date) - $startTime).TotalSeconds)
                Write-Host "`r  ✔ Mô hình đã nạp thành công vào RAM/VRAM (${totalSec}s)!            " -ForegroundColor Green
            } else {
                Write-Host "`r  ⚠ Mô hình mất nhiều thời gian nạp hơn dự kiến (kiểm tra backend.log)." -ForegroundColor Yellow
            }
        }
    }
}

# --- 7. Tự động mở trình duyệt Web UI ---
if (-not $NoBrowser) {
    try {
        Start-Process "http://localhost:8000" -ErrorAction SilentlyContinue
    } catch {}
}

# --- 8. Bảng Dashboard trạng thái hoạt động ---
$displayModel = "Chưa kết nối"
if ($ChosenModelFile) {
    $displayModel = $ChosenModelFile.Name
} elseif ($ActiveRunningModel) {
    $displayModel = [System.IO.Path]::GetFileName($ActiveRunningModel)
}

if ($displayModel.Length -gt 42) {
    $displayModel = $displayModel.Substring(0, 39) + "..."
}

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║               ✦  BOBIGO AI STUDIO 2.0 ĐÃ SẴN SÀNG  ✦                     ║" -ForegroundColor Green
Write-Host "  ╠═══════════════════════════════════════════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  🌐 Web Studio:     " -ForegroundColor Green -NoNewline
Write-Host "http://localhost:8000                                 " -ForegroundColor White -NoNewline
Write-Host "║" -ForegroundColor Green
Write-Host "  ║  🤖 LLM Engine:     " -ForegroundColor Green -NoNewline
Write-Host "http://127.0.0.1:11434 (OpenAI Compatible)            " -ForegroundColor White -NoNewline
Write-Host "║" -ForegroundColor Green
Write-Host "  ║  🧠 Active Model:   " -ForegroundColor Green -NoNewline
Write-Host "$($displayModel.PadRight(54))" -ForegroundColor Cyan -NoNewline
Write-Host "║" -ForegroundColor Green
Write-Host "  ║  ⌨ Điều khiển:      " -ForegroundColor Green -NoNewline
Write-Host "Nhấn [Ctrl + C] để dừng toàn bộ an toàn                 " -ForegroundColor Yellow -NoNewline
Write-Host "║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# --- 9. Khởi chạy FastAPI Server ---
try {
    & $Python "$ScriptDir\server.py"
} finally {
    if ($StartedLlama) {
        Write-Host "`n  [DỪNG TIẾN TRÌNH] Đang tắt llama-server an toàn..." -ForegroundColor Red
        Get-Process "llama-server" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

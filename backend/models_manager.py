"""Models Manager — Dynamic llama-server execution and GGUF selection"""

from __future__ import annotations

import glob
import logging
import os
import platform
import subprocess
from typing import Any

from backend.config import BASE_DIR, DEFAULT_MODEL

logger = logging.getLogger("bobigo.models")

MODELS_DIR = os.path.join(BASE_DIR, "models")
LLAMA_SERVER_PORT = "11434"
LOG_PATH = os.path.join(BASE_DIR, "backend.log")

# Track the active process locally
_llama_process: subprocess.Popen | None = None


def list_available_models() -> list[dict[str, Any]]:
    """Scan models/ directory for available GGUF files."""
    if not os.path.exists(MODELS_DIR):
        return []

    pattern = os.path.join(MODELS_DIR, "*.gguf")
    files = glob.glob(pattern)
    models_list = []

    for f in files:
        name = os.path.basename(f)
        # Skip vision mmproj helper files
        if name.lower().startswith("mmproj"):
            continue

        size_bytes = os.path.getsize(f)
        size_gb = round(size_bytes / (1024 * 1024 * 1024), 2)

        models_list.append({
            "filename": name,
            "path": f,
            "size_gb": size_gb,
            "is_default": (name == DEFAULT_MODEL),
        })

    # Default model first, then alphabetical
    models_list.sort(key=lambda x: (not x["is_default"], x["filename"]))
    return models_list


def terminate_llama_server() -> None:
    """Kill any running llama-server processes."""
    global _llama_process

    # 1. Kill the process tracked by Popen
    if _llama_process is not None:
        try:
            logger.info("Terminating tracked llama-server process...")
            _llama_process.terminate()
            _llama_process.wait(timeout=3)
        except Exception:
            try:
                _llama_process.kill()
            except Exception:
                pass
        _llama_process = None

    # 2. Force kill any system processes to ensure port 11434 is freed
    sys_type = platform.system()
    try:
        if sys_type == "Windows":
            logger.info("Running taskkill for llama-server.exe")
            subprocess.run(
                ["taskkill", "/f", "/im", "llama-server.exe"],
                capture_output=True,
                check=False,
            )
        else:
            logger.info("Running pkill for llama-server")
            subprocess.run(
                ["pkill", "-f", "llama-server"],
                capture_output=True,
                check=False,
            )
    except Exception as e:
        logger.warning(f"Error during system process cleanup: {e}")


def start_llama_server(model_filename: str) -> bool:
    """Launch llama-server with the specified GGUF model."""
    global _llama_process

    model_path = os.path.join(MODELS_DIR, model_filename)
    if not os.path.exists(model_path):
        logger.error(f"Model path does not exist: {model_path}")
        return False

    terminate_llama_server()

    sys_type = platform.system()
    if sys_type == "Windows":
        llama_executable = os.path.join(BASE_DIR, "bin", "llama-server.exe")
        if not os.path.exists(llama_executable):
            llama_executable = "llama-server.exe"
    else:
        llama_executable = "llama-server"

    name_lower = model_filename.lower()
    is_moe = "a3b" in name_lower or "-moe" in name_lower

    cmd = [
        llama_executable,
        "-m", model_path,
        "--port", LLAMA_SERVER_PORT,
        "-fa", "on",
        "-c", os.environ.get("CONTEXT_WINDOW", "16384"),
        "-np", "1",
        "--host", "127.0.0.1",
        "--jinja",
        "-ctk", "q4_0",
        "-ctv", "q4_0",
        "--log-file", LOG_PATH,
    ]

    # Multimodal projector check (only if BOBIGO_VISION is set)
    if os.environ.get("BOBIGO_VISION") == "1":
        mmproj_pattern = os.path.join(MODELS_DIR, "mmproj*.gguf")
        mmprojs = glob.glob(mmproj_pattern)
        if mmprojs:
            cmd += ["--mmproj", mmprojs[0]]

    ngl_override = os.environ.get("LLM_NGL")
    if ngl_override:
        cmd += ["-ngl", ngl_override]
    elif is_moe:
        if "iq2_m" in name_lower:
            ngl = "40"
        elif "iq3_m" in name_lower or "q2_k" in name_lower:
            ngl = "26"
        elif "iq4_xs" in name_lower or "q3_k" in name_lower:
            ngl = "20"
        elif "iq4_nl" in name_lower or "q4_k_m" in name_lower:
            ngl = "18"
        elif "q4_k_p" in name_lower:
            ngl = "16"
        else:
            ngl = "16"
        cmd += ["-ngl", ngl]
        if os.environ.get("LLAMA_CPU_MOE") == "1":
            cmd += ["--cpu-moe"]
    else:
        ngl = "24"
        if "qwen3.8" in name_lower:
            ngl = "18"
        elif "qwen3.6" in name_lower or "qwen35b" in name_lower:
            ngl = "28"
        cmd += ["-ngl", ngl]

    threads = os.environ.get("LLM_THREADS", "8")
    cmd += ["-t", str(threads), "-tb", str(threads)]

    logger.info(f"Launching llama-server: {' '.join(cmd)}")

    try:
        working_dir = os.path.join(BASE_DIR, "bin") if sys_type == "Windows" else BASE_DIR
        env = os.environ.copy()
        if sys_type == "Windows":
            env["PATH"] = f"{working_dir};" + env.get("PATH", "")
            _llama_process = subprocess.Popen(
                cmd,
                cwd=working_dir,
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            )
        else:
            _llama_process = subprocess.Popen(
                cmd,
                cwd=working_dir,
                env=env,
                preexec_fn=os.setsid,
            )
        return True
    except Exception as e:
        logger.error(f"Failed to launch llama-server: {e}")
        return False

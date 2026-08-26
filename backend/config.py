"""Bobigo AI Agent — Configuration"""

import os

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, "web")

# Server — loopback by default so local tools are not reachable on LAN
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))

# LLM Backend (llama-server)
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:11434")
LLM_TIMEOUT = 300  # seconds — long timeout for slow generation

# Database (PostgreSQL via Docker — see docker-compose.yml)
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://bobigo:bobigo@127.0.0.1:5433/bobigo"
)

# Agent defaults
DEFAULT_MODEL = "qwen35b-uncensored"
DEFAULT_SYSTEM_PROMPT = (
    "Bạn là Bobigo, trợ lý AI. Trả lời chính xác, hữu ích và thân thiện."
)
DEFAULT_SYSTEM_PROMPT_EN = (
    "You are Bobigo, an AI assistant. Be accurate, useful, and friendly."
)

# Tool settings
CODE_EXEC_TIMEOUT = 15  # seconds
MAX_SEARCH_RESULTS = 5
MAX_AGENT_ITERATIONS = 6  # prevent infinite tool loops
MAX_URL_BYTES = 1_000_000
URL_FETCH_TIMEOUT = 15
MAX_REDIRECTS = 5
DDG_URL = "https://html.duckduckgo.com/html/"
MAX_READ_BYTES = 80_000
MAX_LIST_ENTRIES = 200

# Sandbox execution backend for code_interpreter: "local" (host python -I,
# default) or "docker" (opt-in, runs each snippet in a throwaway
# --network none container of SANDBOX_IMAGE).
SANDBOX_RUNTIME = os.environ.get("SANDBOX_RUNTIME", "local").lower()
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "python:3.12-slim")

# Uploads (/api/extract-file, /api/to-markdown). Enforced server-side so the
# browser-side 25MB check is not the only line of defense.
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

# Agent-generated files (generated/) are garbage-collected on startup after this
# many hours so the folder cannot grow forever.
GENERATED_TTL_HOURS = float(os.environ.get("GENERATED_TTL_HOURS", "72"))

# Logging verbosity for the backend ("DEBUG"|"INFO"|"WARNING"|...).
LOG_LEVEL = os.environ.get("BOBIGO_LOG_LEVEL", "INFO").upper()

CONTEXT_WINDOW = int(os.environ.get("CONTEXT_WINDOW", "8192"))
REPLY_RESERVE = 2048
TOOL_RESULT_CAP = 2500

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

# Agent defaults
DEFAULT_MODEL = "qwen35b-uncensored"
DEFAULT_SYSTEM_PROMPT = (
    "Bạn là Bobigo, trợ lý AI. "
    "Bạn có các công cụ: web_search, calculator, code_interpreter, url_reader, list_files, read_file. "
    "Hãy dùng tool khi cần. Trả lời chính xác, hữu ích và thân thiện."
)
DEFAULT_SYSTEM_PROMPT_EN = (
    "You are Bobigo, an AI assistant. "
    "You have tools: web_search, calculator, code_interpreter, url_reader, list_files, read_file. "
    "Use a tool when it helps. Be accurate, useful, and friendly."
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
CONTEXT_WINDOW = int(os.environ.get("CONTEXT_WINDOW", "8192"))
REPLY_RESERVE = 2048
TOOL_RESULT_CAP = 2500

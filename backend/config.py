"""
Settings, read once from the environment. .env files are loaded here:
backend/.env first, then the repo-root .env (load_dotenv never overrides a
variable that's already set).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(BACKEND_DIR / ".env")
load_dotenv(BACKEND_DIR.parent / ".env")


def _csv(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Browser origins allowed to call the API (CORS) and to open the WebSocket.
FRONTEND_ORIGINS = _csv("FRONTEND_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080")

# Accounts allowed to use admin/write routes. Empty means nobody (fail closed).
ADMIN_EMAILS = {e.lower() for e in _csv("ADMIN_EMAILS")}

# Upload limits. A 10 s browser clip is ~160 KB; a full song as MP3 is ~5-10 MB.
MB = 1024 * 1024
MAX_IDENTIFY_BYTES = 25 * MB
MAX_SONG_UPLOAD_BYTES = 60 * MB
MAX_IDENTIFY_SECONDS = 10 * 60
MAX_SONG_SECONDS = 20 * 60
MAX_WS_BUFFER_BYTES = 4 * MB  # ~4 minutes of 128 kbps Opus from MediaRecorder

# Fingerprint lookups sent to Supabase at the same time (process-wide cap).
# Keeps parallel lookups fast without flooding the API; lower it if you see 429s.
DB_QUERY_CONCURRENCY = max(1, int(os.getenv("DB_QUERY_CONCURRENCY", "6")))

"""
Receiving audio uploads safely:
  - UploadSizeLimit rejects oversized bodies before they're buffered to disk
  - save_upload writes to a fixed name (the client's filename is never a path)
  - probe_audio checks the bytes really are audio, using ffprobe, since the
    Content-Type header is whatever the client claims
  - workspace() gives each request its own temp folder, always removed
"""

import contextlib
import json
import os
import re
import shutil
import subprocess
import tempfile

from fastapi import HTTPException, UploadFile
from fastapi.responses import JSONResponse

MB = 1024 * 1024

# Cheap first filter on the client-declared type; probe_audio is the real check.
# octet-stream is allowed because some OS/browser combos send it for .m4a/.flac.
_ALLOWED_TYPES = re.compile(r"^(audio/.+|video/(webm|mp4|ogg)|application/octet-stream)$")


def _too_large(limit: int) -> str:
    return f"File too large (max {limit // MB} MB)."


class UploadSizeLimit:
    """
    ASGI middleware: per-path cap on POST body size. Checks Content-Length up
    front, and counts bytes as they arrive for uploads that don't send one.
    """

    def __init__(self, app, limits: dict[str, int]):
        self.app = app
        self.limits = limits

    async def __call__(self, scope, receive, send):
        limit = None
        if scope["type"] == "http" and scope["method"] == "POST":
            limit = self.limits.get(scope["path"])
        if limit is None:
            return await self.app(scope, receive, send)

        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            return await JSONResponse({"detail": _too_large(limit)}, status_code=413)(scope, receive, send)

        seen = 0

        async def counted_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    # Raised while FastAPI parses the form; it passes HTTPExceptions through.
                    raise HTTPException(413, _too_large(limit))
            return message

        await self.app(scope, counted_receive, send)


@contextlib.contextmanager
def workspace():
    """A private temp folder for one request; deleted however the request ends."""
    path = tempfile.mkdtemp(prefix="wavejack-")
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def save_upload(upload: UploadFile, folder: str, max_bytes: int) -> str:
    if upload.content_type and not _ALLOWED_TYPES.match(upload.content_type):
        raise HTTPException(415, f"Unsupported file type ({upload.content_type}). Upload an audio file.")

    # Keep only a short alphanumeric extension from the client's filename.
    ext = os.path.splitext(upload.filename or "")[1].lower()
    ext = ext if re.fullmatch(r"\.[a-z0-9]{1,5}", ext) else ""
    path = os.path.join(folder, "upload" + ext)

    written = 0
    with open(path, "wb") as out:
        while chunk := upload.file.read(MB):
            written += len(chunk)
            if written > max_bytes:  # backstop if a body slipped past the middleware
                raise HTTPException(413, _too_large(max_bytes))
            out.write(chunk)
    if written == 0:
        raise HTTPException(400, "The uploaded file is empty.")
    return path


def probe_audio(path: str, max_seconds: float) -> float:
    """Returns the duration in seconds; 415 if it isn't decodable audio, 413 if it's too long."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:format=duration",
             "-of", "json", path],
            capture_output=True, timeout=20,
        )
    except FileNotFoundError as e:
        raise HTTPException(500, "ffprobe isn't installed on the server.") from e
    except subprocess.TimeoutExpired as e:
        raise HTTPException(415, "Couldn't read that file as audio.") from e

    try:
        info = json.loads(out.stdout or b"{}")
    except json.JSONDecodeError:
        info = {}
    if out.returncode != 0 or not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise HTTPException(415, "That file doesn't contain audio we can read.")

    try:
        duration = float(info.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        duration = 0.0  # some streams (e.g. MediaRecorder WebM) don't declare one
    if duration > max_seconds:
        raise HTTPException(413, f"Audio too long (max {int(max_seconds // 60)} minutes).")
    return duration

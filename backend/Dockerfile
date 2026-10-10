# WaveJack backend for Hugging Face Spaces (Docker SDK). Build from the backend/ folder:
#   docker build -t wavejack-backend .
#   docker run --rm -p 7860:7860 --env-file .env wavejack-backend
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg/ffprobe: decoding uploads and WebSocket audio (pydub, uploads.probe_audio).
# libsndfile1: soundfile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Spaces runs the container as uid 1000.
RUN useradd --create-home --uid 1000 user

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user:user . .

# librosa compiles parts of itself with numba (cache=True) and caches the result next to the
# installed package, which the non-root user can't write. Point the cache somewhere writable.
ENV HOME=/home/user \
    NUMBA_CACHE_DIR=/tmp/numba-cache

USER user

EXPOSE 7860

# Auto-reload is off unless --reload is passed (uvicorn has no --no-reload option).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]

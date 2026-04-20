import os
import sys
import tempfile
import shutil
import subprocess

sys.path.append("..")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from fingerprint import fingerprint
from database import (
    store_song_with_fingerprints,
    query_fingerprints,
    get_song_by_id
)
from record import record_clip
from collections import Counter

app = FastAPI(title="WaveJack API")

# ─────────────────────────────────────────────
# CORS — allows the React frontend to call this API
# ─────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# HELPER — convert any audio format to WAV via ffmpeg
#
# ROOT CAUSE FIX: The browser's MediaRecorder records audio as
# audio/webm (Opus codec). librosa.load() cannot read WebM without
# this conversion step, which caused a 500 crash on every mic recording.
# ─────────────────────────────────────────────

def convert_to_wav(input_path: str) -> tuple[str, bool]:
    """
    Convert an audio file to 22050 Hz mono WAV using ffmpeg.
    Returns (wav_path, needs_cleanup).
      - If input is already .wav, returns it unchanged (needs_cleanup=False).
      - On ffmpeg failure, returns the original path so librosa can try anyway.
    """
    if input_path.lower().endswith(".wav"):
        return input_path, False

    wav_path = input_path + "_converted.wav"
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-ar", "22050",   # match fingerprint.py SAMPLE_RATE
                "-ac", "1",       # mono
                "-f", "wav",
                wav_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0:
            return wav_path, True
        else:
            print("ffmpeg conversion failed:", result.stderr.decode(errors="replace"))
    except FileNotFoundError:
        print(
            "WARNING: ffmpeg not found. Install ffmpeg so the backend can read "
            "browser-recorded audio (WebM/Opus). "
            "Download: https://ffmpeg.org/download.html"
        )
    except subprocess.TimeoutExpired:
        print("ffmpeg conversion timed out")

    # Fall back — let librosa try to handle the original file directly
    return input_path, False


# ─────────────────────────────────────────────
# HELPER — run recognition on any audio file path
# ─────────────────────────────────────────────

def run_recognition(audio_path: str) -> dict:
    """
    Core recognition logic — fingerprint the clip,
    query the DB, vote on the best match, return song details.
    """
    hashes = fingerprint(audio_path)

    if not hashes:
        raise HTTPException(status_code=400, detail="Could not extract fingerprints from audio")

    hash_vals = [h[0] for h in hashes]
    matches = query_fingerprints(hash_vals)

    if not matches:
        raise HTTPException(status_code=404, detail="No matching song found")

    # vote — whichever song_id appears most is the winner
    song_id_counts = Counter(m["song_id"] for m in matches)
    best_song_id, hit_count = song_id_counts.most_common(1)[0]

    song = get_song_by_id(best_song_id)

    if not song:
        raise HTTPException(status_code=404, detail="Matched song not found in database")

    return {
        "title": song["title"],
        "artist": song["artist"],
        "youtube_url": song.get("youtube_url"),
        "filename": song.get("filename"),
        "song_id": best_song_id,
        "matched_hashes": hit_count,
    }


# ─────────────────────────────────────────────
# POST /recognize — upload an audio file
# ─────────────────────────────────────────────

@app.post("/recognize")
async def recognize_upload(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[-1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    wav_path = None

    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        wav_path, _ = convert_to_wav(tmp_path)
        result = run_recognition(wav_path)
    finally:
        tmp.close()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if wav_path and wav_path != tmp_path and os.path.exists(wav_path):
            os.unlink(wav_path)

    return result


# ─────────────────────────────────────────────
# POST /recognize/record — record from mic then recognize
# ─────────────────────────────────────────────

@app.post("/recognize/record")
async def recognize_from_mic(duration: int = 10):
    """
    Records audio from the server's microphone for `duration` seconds,
    fingerprints it, and returns the matching song.
    """
    clip_path = record_clip(duration=duration)

    try:
        result = run_recognition(clip_path)
    finally:
        if os.path.exists(clip_path):
            os.unlink(clip_path)

    return result


# ─────────────────────────────────────────────
# POST /songs — add a new song to the database
# ─────────────────────────────────────────────

@app.post("/songs")
async def add_song(
    title: str = Form(...),
    artist: str = Form(...),
    youtube_url: str = Form(None),
    file: UploadFile = File(...),
):
    suffix = os.path.splitext(file.filename)[-1] or ".mp3"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    wav_path = None

    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        wav_path, _ = convert_to_wav(tmp_path)
        hashes = fingerprint(wav_path)

        if not hashes:
            raise HTTPException(status_code=400, detail="Could not extract fingerprints from audio")

        song_id = store_song_with_fingerprints(
            title=title,
            artist=artist,
            filename=file.filename,
            hashes=hashes,
            youtube_url=youtube_url,
        )
    finally:
        tmp.close()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if wav_path and wav_path != tmp_path and os.path.exists(wav_path):
            os.unlink(wav_path)

    return {
        "message": "Song added successfully",
        "song_id": song_id,
        "title": title,
        "artist": artist,
        "fingerprints_stored": len(hashes),
    }


# ─────────────────────────────────────────────
# GET /songs — list all songs in the database
# ─────────────────────────────────────────────

@app.get("/songs")
async def list_songs():
    from database import get_client
    client = get_client()
    response = client.table("songs").select("*").execute()
    return {"songs": response.data, "count": len(response.data)}


# ─────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "WaveJack API is running"}


# ─────────────────────────────────────────────
# POST /identify — the endpoint the frontend mic button calls
#
# FIXES applied here:
#   1. convert_to_wav() handles browser WebM/Opus before fingerprinting
#   2. Response now includes `confidence` and `offset` fields that the
#      frontend's IdentifyResponse type requires (were missing before,
#      causing NaN% confidence even on successful matches)
# ─────────────────────────────────────────────

@app.post("/identify")
async def identify_upload(file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[-1] or ".webm"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    wav_path = None

    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # FIX 1: convert webm/opus (browser MediaRecorder output) → WAV
        wav_path, _ = convert_to_wav(tmp_path)

        result = run_recognition(wav_path)
    finally:
        tmp.close()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if wav_path and wav_path != tmp_path and os.path.exists(wav_path):
            os.unlink(wav_path)

    # FIX 2: rename + add missing fields so frontend IdentifyResponse is satisfied
    hashes_matched = result.pop("matched_hashes", 0)
    result["hashes_matched"] = hashes_matched

    # Confidence: 200+ matching hashes = ~100%; scale linearly below that.
    result["confidence"] = min(1.0, hashes_matched / 200)

    # Offset: placeholder (proper time-alignment pass would compute this)
    result["offset"] = 0.0

    return result


# ─────────────────────────────────────────────
# POST /add — alias for POST /songs (frontend Admin panel uses this)
# ─────────────────────────────────────────────

@app.post("/add")
async def add_song_alias(
    title: str = Form(...),
    artist: str = Form(...),
    youtube_url: str = Form(None),
    audio: UploadFile = File(...),   # frontend sends field named "audio"
):
    suffix = os.path.splitext(audio.filename)[-1] or ".mp3"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_path = tmp.name
    wav_path = None

    try:
        with open(tmp_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)
        wav_path, _ = convert_to_wav(tmp_path)
        hashes = fingerprint(wav_path)
        if not hashes:
            raise HTTPException(status_code=400, detail="Could not extract fingerprints")
        song_id = store_song_with_fingerprints(
            title=title,
            artist=artist,
            filename=audio.filename,
            hashes=hashes,
            youtube_url=youtube_url,
        )
    finally:
        tmp.close()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        if wav_path and wav_path != tmp_path and os.path.exists(wav_path):
            os.unlink(wav_path)

    return {
        "message": "Song added successfully",
        "song_id": song_id,
        "title": title,
        "artist": artist,
        "fingerprints_stored": len(hashes),
    }


# ─────────────────────────────────────────────
# DELETE /songs/{id} — delete a song
# ─────────────────────────────────────────────

@app.delete("/songs/{song_id}")
async def delete_song(song_id: str):
    from database import get_client
    client = get_client()
    client.table("fingerprints").delete().eq("song_id", song_id).execute()
    res = client.table("songs").delete().eq("id", song_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"message": "Song deleted", "song_id": song_id}


# ─────────────────────────────────────────────
# GET /admin/stats — dashboard stats
# ─────────────────────────────────────────────

@app.get("/admin/stats")
async def admin_stats():
    from database import get_client
    client = get_client()
    songs = client.table("songs").select("id", count="exact").execute()
    return {
        "total_songs": songs.count or 0,
        "total_identifies_today": 0,
        "total_users": 0,
    }


# ─────────────────────────────────────────────
# GET /admin/logs — identify logs
# ─────────────────────────────────────────────

@app.get("/admin/logs")
async def admin_logs():
    return {"logs": []}

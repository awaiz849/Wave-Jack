import os
import subprocess
import json

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile as StarletteUploadFile
from fastapi.middleware.cors import CORSMiddleware

from fingerprint import fingerprint
from database import (
    get_client,
    store_song_with_fingerprints,
    query_fingerprints,
    get_song_by_id
)
from record import record_clip
from collections import Counter
from fastapi import WebSocket, WebSocketDisconnect
from recognizer import (
    fingerprint_buffer,
    MIN_MATCH_VOTES,
    StreamMatcher,
    final_match,
    is_confident,
    song_result,
)
from auth import CurrentUser, require_admin
from config import (
    ADMIN_EMAILS,
    FRONTEND_ORIGINS,
    MAX_IDENTIFY_BYTES,
    MAX_IDENTIFY_SECONDS,
    MAX_SONG_SECONDS,
    MAX_SONG_UPLOAD_BYTES,
    MAX_WS_BUFFER_BYTES,
)
from uploads import UploadSizeLimit, probe_audio, save_upload, workspace
import asyncio
import time
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf


def _warm_up() -> None:
    """
    librosa compiles its numba code on first use, which made the first
    recognition after every (re)start take 15-30 s. Fingerprint two seconds of
    throwaway audio once at startup instead, and build the shared Supabase client.
    """
    t0 = time.perf_counter()
    try:
        with workspace() as folder:
            path = os.path.join(folder, "warmup.wav")
            noise = np.random.default_rng(0).standard_normal(2 * 44100).astype("float32") * 0.1
            sf.write(path, noise, 44100)  # 44.1 kHz so the resampling path is compiled too
            fingerprint(path)
        get_client()
        print(f"Warm-up finished in {time.perf_counter() - t0:.1f}s (librosa compiled, Supabase client ready)", flush=True)
    except Exception as e:  # never stop the server from starting
        print(f"Warm-up skipped: {type(e).__name__}: {e}", flush=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # In the background, so the server accepts requests straight away.
    asyncio.get_running_loop().run_in_executor(None, _warm_up)
    yield


app = FastAPI(title="WaveJack API", lifespan=lifespan)

if not ADMIN_EMAILS:
    print("WARNING: ADMIN_EMAILS is not set, so every admin route will answer 403.")

# ─────────────────────────────────────────────
# MIDDLEWARE
#   Upload size limits run first, inside CORS, so even a 413 carries CORS
#   headers and the browser can show the message. (Last added = outermost.)
# ─────────────────────────────────────────────

app.add_middleware(
    UploadSizeLimit,
    limits={
        "/identify": MAX_IDENTIFY_BYTES,
        "/recognize": MAX_IDENTIFY_BYTES,
        "/add": MAX_SONG_UPLOAD_BYTES,
        "/songs": MAX_SONG_UPLOAD_BYTES,
    },
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,  # auth is a Bearer header, not cookies
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ─────────────────────────────────────────────
# HELPER — convert any audio format to WAV via ffmpeg
#
# The browser's MediaRecorder records audio/webm (Opus), which librosa can't
# read directly, so everything that isn't already WAV goes through ffmpeg.
# ─────────────────────────────────────────────

def convert_to_wav(input_path: str) -> str:
    """
    Convert an audio file to 22050 Hz mono WAV next to the input (so it lives
    in the same request workspace and is cleaned up with it).
    """
    if input_path.lower().endswith(".wav"):
        return input_path

    wav_path = os.path.splitext(input_path)[0] + "_converted.wav"
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
            timeout=120,
        )
    except FileNotFoundError as e:
        raise HTTPException(500, "ffmpeg isn't installed on the server.") from e
    except subprocess.TimeoutExpired as e:
        raise HTTPException(400, "Converting the audio took too long.") from e
    if result.returncode != 0:
        print("ffmpeg conversion failed:", result.stderr.decode(errors="replace")[-500:])
        raise HTTPException(400, "Couldn't decode that audio file.")
    return wav_path


# ─────────────────────────────────────────────
# HELPER — run recognition on any audio file path
# ─────────────────────────────────────────────

def run_recognition(audio_path: str) -> dict:
    """
    Core recognition logic — fingerprint the clip, query the DB,
    then use TIME-OFFSET ALIGNMENT to find the best match.

    Why time-offset alignment instead of simple voting?
    ────────────────────────────────────────────────────
    Simple voting (count matching hashes per song) breaks in noisy
    conditions because noise can randomly generate hashes that happen
    to exist in the database for the wrong song.

    Time-offset alignment adds a second constraint: for a REAL match,
    every matching hash must agree that the clip starts at the same
    position in the song. Concretely:

        time_delta = time_in_song - time_in_clip

    If 50 hashes all have the same time_delta for song X, that's a
    genuine alignment — the probability of noise doing that by chance
    is astronomically low. Random noise hits scatter across all deltas
    and never accumulate enough votes to win.
    """
    hashes = fingerprint(audio_path)

    if not hashes:
        raise HTTPException(status_code=400, detail="Could not extract fingerprints from audio")

    # Build a lookup: hash_value → time position in the clip
    clip_time = {h[0]: h[1] for h in hashes}

    hash_vals = list(clip_time.keys())
    matches = query_fingerprints(hash_vals)

    if not matches:
        raise HTTPException(status_code=404, detail="No matching song found")

    # Vote by (song_id, time_delta) pairs.
    # Bin deltas in groups of 2 frames to absorb tiny timing jitter.
    alignment_votes = Counter()
    for m in matches:
        song_id = m["song_id"]
        time_in_song = m["time_offset"]
        time_in_clip = clip_time.get(m["hash"], 0)
        delta = time_in_song - time_in_clip
        binned_delta = round(delta / 2) * 2   # bin width = 2 frames
        alignment_votes[(song_id, binned_delta)] += 1

    # The winner is the (song_id, delta) pair with the most aligned hashes
    (best_song_id, best_delta), hit_count = alignment_votes.most_common(1)[0]

    # Without this, a handful of chance hash collisions was reported as a match.
    if hit_count < MIN_MATCH_VOTES:
        raise HTTPException(status_code=404, detail="No matching song found")

    song = get_song_by_id(best_song_id)

    if not song:
        raise HTTPException(status_code=404, detail="Matched song not found in database")

    # Convert frame delta to seconds (hop_length=512, sr=22050 by default in librosa)
    offset_seconds = round(best_delta * 512 / 22050, 2)

    return {
        "title": song["title"],
        "artist": song["artist"],
        "youtube_url": song.get("youtube_url"),
        "filename": song.get("filename"),
        "song_id": best_song_id,
        "matched_hashes": hit_count,
        "offset_seconds": offset_seconds,
    }


# ─────────────────────────────────────────────
# SHARED UPLOAD HANDLERS
#   Plain `def` routes below: FastAPI runs them in a worker thread, so the
#   CPU-heavy fingerprinting doesn't freeze the event loop (and the WebSocket).
# ─────────────────────────────────────────────

def _recognize_upload(upload: UploadFile) -> dict:
    with workspace() as folder:
        path = save_upload(upload, folder, MAX_IDENTIFY_BYTES)
        probe_audio(path, MAX_IDENTIFY_SECONDS)
        return run_recognition(convert_to_wav(path))


def _clean_text(value: str | None, field: str, max_len: int = 200, required: bool = True) -> str | None:
    value = (value or "").strip()
    if not value:
        if required:
            raise HTTPException(422, f"{field} is required.")
        return None
    if len(value) > max_len:
        raise HTTPException(422, f"{field} is too long (max {max_len} characters).")
    return value


def _add_song(title: str, artist: str, youtube_url: str | None, upload: UploadFile) -> dict:
    title = _clean_text(title, "Title")
    artist = _clean_text(artist, "Artist")
    youtube_url = _clean_text(youtube_url, "YouTube URL", max_len=500, required=False)
    if youtube_url and not youtube_url.startswith(("https://", "http://")):
        raise HTTPException(422, "YouTube URL must start with http:// or https://")

    with workspace() as folder:
        path = save_upload(upload, folder, MAX_SONG_UPLOAD_BYTES)
        probe_audio(path, MAX_SONG_SECONDS)
        hashes = fingerprint(convert_to_wav(path))
        if not hashes:
            raise HTTPException(status_code=400, detail="Could not extract fingerprints from audio")

    song_id = store_song_with_fingerprints(
        title=title,
        artist=artist,
        filename=os.path.basename(upload.filename or "upload"),
        hashes=hashes,
        youtube_url=youtube_url,
    )
    return {
        "message": "Song added successfully",
        "song_id": song_id,
        "title": title,
        "artist": artist,
        "fingerprints_stored": len(hashes),
    }


async def _add_song_from_request(request: Request, file_field: str) -> dict:
    """
    The admin upload routes take the raw Request on purpose. With Form()/File()
    parameters, FastAPI reads and buffers the WHOLE upload (up to the 60 MB cap)
    before it runs require_admin, so anyone could make the server accept a full
    upload just to be told 401. Here the auth dependency runs first, and the body
    is only read once the caller is known to be an admin.
    """
    form = await request.form(max_files=1, max_fields=10)
    try:
        upload = form.get(file_field)
        if not isinstance(upload, StarletteUploadFile):
            raise HTTPException(422, f"Attach the audio file as the '{file_field}' form field.")
        fields = {k: form.get(k) for k in ("title", "artist", "youtube_url")}
        if any(v is not None and not isinstance(v, str) for v in fields.values()):
            raise HTTPException(422, "title, artist and youtube_url must be text fields.")
        # Fingerprinting is CPU-heavy; keep it off the event loop.
        return await run_in_threadpool(
            _add_song, fields["title"], fields["artist"], fields["youtube_url"], upload
        )
    finally:
        await form.close()


def _song_form_docs(file_field: str) -> dict:
    """Describe the multipart body in /docs, since the route reads it by hand."""
    return {"requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {
        "type": "object",
        "required": ["title", "artist", file_field],
        "properties": {
            "title": {"type": "string"},
            "artist": {"type": "string"},
            "youtube_url": {"type": "string"},
            file_field: {"type": "string", "format": "binary"},
        },
    }}}}}


# ─────────────────────────────────────────────
# POST /recognize — upload an audio file
# ─────────────────────────────────────────────

@app.post("/recognize")
def recognize_upload(file: UploadFile = File(...)):
    return _recognize_upload(file)


# ─────────────────────────────────────────────
# POST /recognize/record — record from the SERVER's mic, then recognize
# (admin only: it uses the machine running the API, not the visitor's mic)
# ─────────────────────────────────────────────

@app.post("/recognize/record")
def recognize_from_mic(duration: int = 10, _: CurrentUser = Depends(require_admin)):
    """
    Records audio from the server's microphone for `duration` seconds,
    fingerprints it, and returns the matching song.
    """
    if not 1 <= duration <= 30:
        raise HTTPException(422, "duration must be between 1 and 30 seconds")
    clip_path = record_clip(duration=duration)

    try:
        return run_recognition(clip_path)
    finally:
        if os.path.exists(clip_path):
            os.unlink(clip_path)


# ─────────────────────────────────────────────
# POST /songs — add a new song to the database (admin)
# ─────────────────────────────────────────────

@app.post("/songs", openapi_extra=_song_form_docs("file"))
async def add_song(request: Request, _: CurrentUser = Depends(require_admin)):
    return await _add_song_from_request(request, "file")


# ─────────────────────────────────────────────
# GET /songs — list all songs in the database
# ─────────────────────────────────────────────

@app.get("/songs")
def list_songs():
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
# POST /identify — the endpoint the frontend's upload button calls.
# Response adds `confidence` and `offset`, which the frontend's
# IdentifyResponse type expects.
# ─────────────────────────────────────────────

@app.post("/identify")
def identify_upload(file: UploadFile = File(...)):
    result = _recognize_upload(file)

    hashes_matched = result.pop("matched_hashes", 0)
    result["hashes_matched"] = hashes_matched
    result["confidence"] = min(1.0, hashes_matched / 200)
    result["offset"] = result.pop("offset_seconds", 0.0)

    return result


# ─────────────────────────────────────────────
# POST /add — alias for POST /songs (frontend Admin panel uses this; admin)
# ─────────────────────────────────────────────

@app.post("/add", openapi_extra=_song_form_docs("audio"))
async def add_song_alias(request: Request, _: CurrentUser = Depends(require_admin)):
    return await _add_song_from_request(request, "audio")  # frontend sends the field as "audio"


# ─────────────────────────────────────────────
# DELETE /songs/{id} — delete a song (admin)
# ─────────────────────────────────────────────

@app.delete("/songs/{song_id}")
def delete_song(song_id: int, _: CurrentUser = Depends(require_admin)):
    client = get_client()
    client.table("fingerprints").delete().eq("song_id", song_id).execute()
    res = client.table("songs").delete().eq("id", song_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"message": "Song deleted", "song_id": song_id}


# ─────────────────────────────────────────────
# GET /admin/me — lets the frontend ask "am I an admin?" (403 if not)
# ─────────────────────────────────────────────

@app.get("/admin/me")
def admin_me(user: CurrentUser = Depends(require_admin)):
    return {"email": user.email}


# ─────────────────────────────────────────────
# GET /admin/stats — dashboard stats (admin)
# ─────────────────────────────────────────────

@app.get("/admin/stats")
def admin_stats(_: CurrentUser = Depends(require_admin)):
    client = get_client()
    songs = client.table("songs").select("id", count="exact").execute()
    return {
        "total_songs": songs.count or 0,
        "total_identifies_today": 0,
        "total_users": 0,
    }


# ─────────────────────────────────────────────
# GET /admin/logs — identify logs (admin)
# ─────────────────────────────────────────────

@app.get("/admin/logs")
def admin_logs(_: CurrentUser = Depends(require_admin)):
    return {"logs": []}


async def _close_quietly(websocket: WebSocket) -> None:
    """Close after answering; the client may already have hung up, which is fine."""
    try:
        await websocket.close()
    except (RuntimeError, WebSocketDisconnect):
        pass


async def _match_round(matcher: StreamMatcher, snapshot: bytes) -> list[tuple[int, int]]:
    hashes = await asyncio.to_thread(fingerprint_buffer, snapshot)
    return await asyncio.to_thread(matcher.update, hashes)


@app.websocket("/ws/recognize")
async def recognize_stream(websocket: WebSocket):
    """
    Streaming recognition with early stopping.

    The browser sends WebM pieces every second or so. A matching round starts on
    the first piece and, after that, as soon as the previous round finishes and new
    audio has arrived — it never waits for the next piece to show up. Rounds share
    one StreamMatcher, so each only looks up the hashes the new audio added.
    The answer goes out the moment a round is confident (recognizer.is_confident);
    otherwise, after {"type": "done"}, a last round covers everything and the
    usual MIN_MATCH_VOTES rule decides.
    """
    # CORS doesn't apply to WebSockets, so check the page's origin here.
    # Browsers always send Origin; non-browser clients (scripts) may omit it.
    origin = websocket.headers.get("origin")
    if origin and origin not in FRONTEND_ORIGINS:
        print(f"WebSocket rejected: origin {origin!r} not in FRONTEND_ORIGINS")
        await websocket.close(code=1008)  # policy violation (handshake gets a 403)
        return

    await websocket.accept()
    t0 = time.perf_counter()
    audio_buffer = bytearray()
    matcher = StreamMatcher()
    ranked: list[tuple[int, int]] = []  # latest round's scores
    scored_bytes = 0  # how much of the buffer the latest finished round covered
    round_task: asyncio.Task | None = None
    round_bytes = 0  # how much of the buffer the running round covers
    recv_task: asyncio.Task | None = asyncio.create_task(websocket.receive())
    recording_done = False

    async def send_match(best: tuple[int, int], how: str) -> None:
        result = await asyncio.to_thread(song_result, best[1], best[0])
        print(f"Match ({how}) at {time.perf_counter() - t0:.1f}s: {result['title']} "
              f"({best[0]} votes, runner-up {ranked[1][0] if len(ranked) > 1 else 0})")
        await websocket.send_json({"status": "match", "result": result})
        await asyncio.sleep(1.5)
        await _close_quietly(websocket)

    try:
        while True:
            # Start a round whenever none is running and there's audio it hasn't scored yet.
            if round_task is None and len(audio_buffer) > scored_bytes:
                round_bytes = len(audio_buffer)
                round_task = asyncio.create_task(_match_round(matcher, bytes(audio_buffer)))

            if recording_done and round_task is None:
                break  # everything received has been scored

            waiting = {t for t in (recv_task, round_task) if t is not None}
            finished, _ = await asyncio.wait(waiting, return_when=asyncio.FIRST_COMPLETED)

            if round_task in finished:
                try:
                    ranked = round_task.result()
                except Exception as e:
                    # A partial buffer can fail to decode; the next round has more audio.
                    print(f"Matching round failed at {round_bytes} bytes: {type(e).__name__}: {e}")
                    if recording_done and round_bytes == len(audio_buffer):  # nothing left to retry with
                        await websocket.send_json(
                            {"status": "error", "detail": "The server couldn't process that recording."}
                        )
                        await _close_quietly(websocket)
                        return
                scored_bytes = round_bytes
                round_task = None
                if is_confident(ranked):
                    await send_match(ranked[0], "early")
                    return

            if recv_task in finished:
                message = recv_task.result()
                recv_task = None
                if message.get("type") == "websocket.disconnect":
                    print("Client disconnected")
                    return
                if message.get("text"):
                    data = json.loads(message["text"])
                    if data.get("type") == "done":
                        print(f"Done signal at {time.perf_counter() - t0:.1f}s, buffer {len(audio_buffer)} bytes")
                        recording_done = True
                elif message.get("bytes"):
                    chunk = message["bytes"]
                    if len(audio_buffer) + len(chunk) > MAX_WS_BUFFER_BYTES:
                        await websocket.send_json({"status": "error", "detail": "Recording too long."})
                        await websocket.close(code=1009)  # message too big
                        return
                    audio_buffer.extend(chunk)
                    await websocket.send_json({"status": "listening"})
                if not recording_done:
                    recv_task = asyncio.create_task(websocket.receive())

        best = final_match(ranked)
        if best:
            await send_match(best, "final")
        else:
            print(f"No match at {time.perf_counter() - t0:.1f}s (best {ranked[0][0] if ranked else 0} votes)")
            await websocket.send_json({"status": "no_match"})
            await asyncio.sleep(1.5)
            await _close_quietly(websocket)

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
    finally:
        for task in (recv_task, round_task):
            if task is not None and not task.done():
                task.cancel()

import numpy as np
import io
from pydub import AudioSegment
from fingerprint import fingerprint
from database import get_client

CONFIDENCE_THRESHOLD = 5
SAMPLE_RATE = 22050

def fingerprint_buffer(audio_bytes: bytes) -> list[tuple[str, int]]:
    import tempfile, os
    audio_io = io.BytesIO(audio_bytes)
    audio_segment = AudioSegment.from_file(audio_io, format="webm")
    audio_segment = audio_segment.set_channels(1).set_frame_rate(22050)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
        audio_segment.export(tmp_path, format="wav")

    try:
        return fingerprint(tmp_path)
    finally:
        os.remove(tmp_path)


def query_hashes(hashes: list[tuple[str, int]]) -> dict | None:
    if not hashes:
        return None
    hashes = hashes[:500]
    supabase = get_client()
    hash_list = [h for h, _ in hashes]

    results = []
    batch_size = 500
    for i in range(0, len(hash_list), batch_size):
        batch = hash_list[i:i + batch_size]
        resp = supabase.table("fingerprints") \
            .select("hash, time_offset, song_id") \
            .in_("hash", batch) \
            .execute()
        results.extend(resp.data)

    if not results:
        return None

    hash_map = {h: offset for h, offset in hashes}
    histogram: dict[int, dict[int, int]] = {}

    for row in results:
        song_id = row["song_id"]
        db_offset = row["time_offset"]
        query_offset = hash_map.get(row["hash"])
        if query_offset is None:
            continue
        delta = db_offset - query_offset
        histogram.setdefault(song_id, {})
        histogram[song_id][delta] = histogram[song_id].get(delta, 0) + 1

    best_song_id, best_score = None, 0
    for song_id, deltas in histogram.items():
        score = max(deltas.values())
        if score > best_score:
            best_score = score
            best_song_id = song_id

    if best_score < CONFIDENCE_THRESHOLD:
        return None

    song = supabase.table("songs") \
        .select("title, artist, youtube_url") \
        .eq("id", best_song_id) \
        .single() \
        .execute()

    return {
        "song_id": best_song_id,
        "title": song.data["title"],
        "artist": song.data["artist"],
        "youtube_url": song.data.get("youtube_url"),
        "confidence": round(min(1.0, best_score / 200), 2)
    }
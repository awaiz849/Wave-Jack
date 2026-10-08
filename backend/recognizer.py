import numpy as np
import io
import os
from pydub import AudioSegment
from uploads import workspace
from fingerprint import fingerprint
from database import get_client, query_fingerprints

# Fewest time-aligned votes we'll call a match, for both /identify and the WebSocket.
# Measured with scripts/recognition_harness.py over 238 clips: the best WRONG song
# never got more than 8 votes, so anything below ~2x that is noise, not a match.
MIN_MATCH_VOTES = 15
SAMPLE_RATE = 22050

def fingerprint_buffer(audio_bytes: bytes) -> list[tuple[str, int]]:
    audio_io = io.BytesIO(audio_bytes)
    audio_segment = AudioSegment.from_file(audio_io, format="webm")
    audio_segment = audio_segment.set_channels(1).set_frame_rate(22050)

    # The temp folder is removed even if the export itself fails.
    with workspace() as folder:
        wav_path = os.path.join(folder, "buffer.wav")
        audio_segment.export(wav_path, format="wav").close()  # export() returns an open handle
        return fingerprint(wav_path)


# Early stopping (WebSocket only): answer before the recording ends as soon as the
# evidence is unambiguous — the top song has at least MIN_MATCH_VOTES aligned votes
# AND at least EARLY_STOP_MARGIN times as many as the best OTHER song. Otherwise keep
# listening; the answer at the end of the recording uses MIN_MATCH_VOTES alone, as before.
EARLY_STOP_MARGIN = 3.0


class StreamMatcher:
    """
    Votes for a recording that keeps growing. Every round fingerprints the whole
    buffer (cheap: ~0.3 s) but only looks up hashes it hasn't fetched before, then
    re-scores the whole buffer from all rows fetched so far. So each round's result
    is exactly what a full lookup of the buffer would give, at a fraction of the cost.
    """

    def __init__(self):
        self._rows_by_hash: dict[str, list[dict]] = {}

    def update(self, hashes: list[tuple[str, int]]) -> list[tuple[int, int]]:
        """Returns [(votes, song_id), ...], best first (one entry per song)."""
        new = [h for h in dict.fromkeys(h for h, _ in hashes) if h not in self._rows_by_hash]
        if new:
            rows = query_fingerprints(new)
            for h in new:
                self._rows_by_hash[h] = []
            for row in rows:
                self._rows_by_hash[row["hash"]].append(row)
        return self._score(hashes)

    def _score(self, hashes: list[tuple[str, int]]) -> list[tuple[int, int]]:
        # Same voting as before: count rows per (song, time offset), no binning.
        hash_map = {h: offset for h, offset in hashes}
        histogram: dict[int, dict[int, int]] = {}
        for h, query_offset in hash_map.items():
            for row in self._rows_by_hash.get(h, ()):
                delta = row["time_offset"] - query_offset
                song = histogram.setdefault(row["song_id"], {})
                song[delta] = song.get(delta, 0) + 1
        ranked = [(max(deltas.values()), song_id) for song_id, deltas in histogram.items()]
        ranked.sort(key=lambda x: -x[0])  # stable: ties keep first-seen order
        return ranked


def is_confident(ranked: list[tuple[int, int]]) -> bool:
    """The early-stopping rule: enough votes, and far ahead of every other song."""
    if not ranked or ranked[0][0] < MIN_MATCH_VOTES:
        return False
    runner_up = ranked[1][0] if len(ranked) > 1 else 0
    return ranked[0][0] >= EARLY_STOP_MARGIN * runner_up


def final_match(ranked: list[tuple[int, int]]) -> tuple[int, int] | None:
    """The answer once listening has ended: the top song, if it has enough votes."""
    if ranked and ranked[0][0] >= MIN_MATCH_VOTES:
        return ranked[0]
    return None


def song_result(song_id: int, votes: int) -> dict:
    song = get_client().table("songs") \
        .select("title, artist, youtube_url") \
        .eq("id", song_id) \
        .single() \
        .execute()
    return {
        "song_id": song_id,
        "title": song.data["title"],
        "artist": song.data["artist"],
        "youtube_url": song.data.get("youtube_url"),
        "confidence": round(min(1.0, votes / 200), 2)
    }


def query_hashes(hashes: list[tuple[str, int]]) -> dict | None:
    """One-shot match for a complete recording (used by tests and the final answer)."""
    if not hashes:
        return None
    best = final_match(StreamMatcher().update(hashes))
    return song_result(best[1], best[0]) if best else None
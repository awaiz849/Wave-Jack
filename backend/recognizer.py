import numpy as np
import io
import os
import time
from pydub import AudioSegment
from uploads import workspace
from fingerprint import fingerprint
from database import get_client, match_candidates

# Fewest time-aligned votes we'll call a match, for both /identify and the WebSocket.
# Measured with scripts/recognition_harness.py over 238 clips: the best WRONG song
# never got more than 8 votes, so anything below ~2x that is noise, not a match.
MIN_MATCH_VOTES = 15
SAMPLE_RATE = 22050

def fingerprint_buffer(audio_bytes: bytes, timings: dict | None = None) -> list[tuple[str, int]]:
    """Decode a WebM buffer and fingerprint it. `timings`, if given, gets decode_ms / fingerprint_ms."""
    t0 = time.perf_counter()
    audio_io = io.BytesIO(audio_bytes)
    audio_segment = AudioSegment.from_file(audio_io, format="webm")
    audio_segment = audio_segment.set_channels(1).set_frame_rate(22050)

    # The temp folder is removed even if the export itself fails.
    with workspace() as folder:
        wav_path = os.path.join(folder, "buffer.wav")
        audio_segment.export(wav_path, format="wav").close()  # export() returns an open handle
        t1 = time.perf_counter()
        hashes = fingerprint(wav_path)
    if timings is not None:
        timings["decode_ms"] = (t1 - t0) * 1000
        timings["fingerprint_ms"] = (time.perf_counter() - t1) * 1000
        timings["hashes"] = len(hashes)
    return hashes


# Early stopping (WebSocket only): answer before the recording ends as soon as the
# evidence is unambiguous — the top song has at least MIN_MATCH_VOTES aligned votes
# AND at least EARLY_STOP_MARGIN times as many as the best OTHER song. Otherwise keep
# listening; the answer at the end of the recording uses MIN_MATCH_VOTES alone, as before.
EARLY_STOP_MARGIN = 3.0


class StreamMatcher:
    """
    Votes for a recording that keeps growing. Every round fingerprints the whole
    buffer and scores all of it in one database call (match_votes, exact deltas,
    no binning): count rows per (song, time offset), each song's best offset wins.
    The lookup and the counting happen in Postgres, so a round costs one round trip
    however long the buffer is.
    """

    def update(self, hashes: list[tuple[str, int]], timings: dict | None = None) -> list[tuple[int, int]]:
        """Returns [(votes, song_id), ...], best first (one entry per song).

        `timings`, if given, gets lookup_ms / requests / new_hashes / rows / vote_ms
        (lookup_ms includes the voting, which now runs in the database).
        """
        t0 = time.perf_counter()
        hash_map = {h: offset for h, offset in hashes}
        stats: dict = {"requests": 0}
        candidates = match_candidates(hash_map, bin_width=1, stats=stats)
        if timings is not None:
            timings["lookup_ms"] = (time.perf_counter() - t0) * 1000
            timings["requests"] = stats["requests"]
            timings["new_hashes"] = len(hash_map)  # every round sends the whole buffer's hashes
            timings["rows"] = len(candidates)  # one row per song comes back
            timings["vote_ms"] = 0.0
        return [(votes, song_id) for votes, song_id, _ in candidates]


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


def runner_up(ranked: list[tuple[int, int]], song_id: int) -> int:
    """Votes of the best song other than `song_id` (0 if there is none)."""
    return next((votes for votes, sid in ranked if sid != song_id), 0)


def song_result(song_id: int, votes: int, runner_up_votes: int = 0) -> dict:
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
        "votes": votes,
        "runner_up_votes": runner_up_votes,
        "confidence": round(min(1.0, votes / 200), 2),  # legacy; the UI no longer shows it
    }


def query_hashes(hashes: list[tuple[str, int]]) -> dict | None:
    """One-shot match for a complete recording (used by tests and the final answer)."""
    if not hashes:
        return None
    ranked = StreamMatcher().update(hashes)
    best = final_match(ranked)
    return song_result(best[1], best[0], runner_up(ranked, best[1])) if best else None
"""
WaveJack recognition test harness.

Cuts a clip out of a library song, optionally degrades it (lower volume, white
noise, Opus/WebM encoding like the browser's MediaRecorder), then runs it through
the SAME code the backend uses and prints the top candidates.

  identify path : main.convert_to_wav -> main.run_recognition   (POST /identify)
  ws path       : recognizer.fingerprint_buffer -> recognizer.query_hashes   (WS /ws/recognize)

The backend functions are called for real; the harness only wraps them to record
the hashes and DB rows they used, so it can show every candidate's votes, not just
the winner. Nothing in backend/ is modified.

Run from the repo root with the backend venv:
  backend\\venv\\Scripts\\python scripts\\recognition_harness.py suite
  backend\\venv\\Scripts\\python scripts\\recognition_harness.py clip data/songs/test2.mp3 --start 60 --snr 5 --format webm
  backend\\venv\\Scripts\\python scripts\\recognition_harness.py params data/songs/test.mp3
"""

import argparse
import contextlib
import io
import os
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict

import numpy as np
import soundfile as sf

BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
sys.path.insert(0, BACKEND)

with contextlib.redirect_stdout(io.StringIO()):  # main.py prints on import paths; keep output clean
    import main  # noqa: E402
    import recognizer  # noqa: E402
    import fingerprint as fp  # noqa: E402
    import database  # noqa: E402

from fastapi import HTTPException  # noqa: E402

SONGS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "songs")
HOP_SECONDS = 512 / 22050  # librosa default hop / fingerprint.SAMPLE_RATE (same constant main.py uses)
PG_MAX_ROWS = 1000  # Supabase/PostgREST default max rows per request


# ─────────────────────────────────────────────
# Library lookup
# ─────────────────────────────────────────────

_songs_cache = None


def library():
    global _songs_cache
    if _songs_cache is None:
        rows = database.get_client().table("songs").select("id, title, artist, filename").execute().data
        _songs_cache = {r["id"]: r for r in rows}
    return _songs_cache


def song_id_for_file(path):
    name = os.path.basename(path)
    ids = [sid for sid, s in library().items() if (s.get("filename") or "") == name]
    return ids[0] if len(ids) == 1 else (ids or None)


def title(sid):
    s = library().get(sid)
    return f"{s['title'][:28]} / {s['artist'][:16]}" if s else f"<id {sid}>"


# ─────────────────────────────────────────────
# Clip generation
# ─────────────────────────────────────────────

def ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def load_segment(path, start, duration, sr=44100):
    """Decode [start, start+duration) as mono float32 at `sr` — roughly what a mic/browser would hand us."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(duration), "-i", path,
         "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).copy(), sr


def degrade(x, gain_db=0.0, snr_db=None, seed=0):
    y = x * (10 ** (gain_db / 20))
    if snr_db is not None:
        rms = np.sqrt(np.mean(y ** 2)) + 1e-12
        noise = np.random.default_rng(seed).standard_normal(len(y)).astype(np.float32)
        y = y + noise * rms / (10 ** (snr_db / 20))
    return np.clip(y, -1.0, 1.0).astype(np.float32)


def write_clip(x, sr, fmt, bitrate="128k"):
    """Write the clip in the format the browser would upload. Returns a temp path."""
    fd, wav = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    sf.write(wav, x, sr, subtype="PCM_16")
    if fmt == "wav":
        return wav
    out = wav[:-4] + ".webm"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", wav, "-c:a", "libopus", "-b:a", bitrate, "-f", "webm", out],
        check=True,
    )
    os.unlink(wav)
    return out


# ─────────────────────────────────────────────
# Instrumented pipelines
# ─────────────────────────────────────────────

class Capture:
    """Wraps backend functions so we can see what they saw, without changing them."""

    def __init__(self):
        self.hashes = None
        self.query_inputs = []
        self.rows = []

    @contextlib.contextmanager
    def patch(self, module, fp_name, query_name=None):
        orig_fp = getattr(module, fp_name)
        orig_q = getattr(module, query_name) if query_name else None

        def fp_wrap(*a, **k):
            h = orig_fp(*a, **k)
            self.hashes = h
            return h

        def q_wrap(hash_vals):
            self.query_inputs.append(list(hash_vals))
            res = orig_q(hash_vals)
            self.rows.extend(res)
            return res

        setattr(module, fp_name, fp_wrap)
        if query_name:
            setattr(module, query_name, q_wrap)
        try:
            yield self
        finally:
            setattr(module, fp_name, orig_fp)
            if query_name:
                setattr(module, query_name, orig_q)


def votes_identify(hashes, rows):
    """Exact replica of main.run_recognition's scoring, but keeping every candidate."""
    clip_time = {h[0]: h[1] for h in hashes}
    votes = Counter()
    for m in rows:
        delta = m["time_offset"] - clip_time.get(m["hash"], 0)
        votes[(m["song_id"], round(delta / 2) * 2)] += 1
    return votes


def votes_ws(hashes, rows):
    """Exact replica of recognizer.query_hashes' scoring (unbinned deltas); pass only the hashes it used."""
    hash_map = {h: o for h, o in hashes}
    votes = Counter()
    for r in rows:
        q = hash_map.get(r["hash"])
        if q is None:
            continue
        votes[(r["song_id"], r["time_offset"] - q)] += 1
    return votes


def per_song_best(votes):
    best = {}
    for (sid, delta), n in votes.items():
        if n > best.get(sid, (0, 0))[0]:
            best[sid] = (n, delta)
    return sorted(((n, sid, d) for sid, (n, d) in best.items()), reverse=True)


class RequestSpy:
    """Records the size of every response from the fingerprints table, whichever module asks."""

    def __init__(self):
        self.sizes = []  # rows per response, in order
        self.rows = []  # every row received (includes responses the backend later discards)

    def wrap(self, real):
        spy = self

        class Q:
            def __init__(self, q):
                self.q = q

            def __getattr__(self, attr):
                v = getattr(self.q, attr)
                if attr == "execute":
                    def ex():
                        r = v()
                        spy.sizes.append(len(r.data))
                        spy.rows.extend(r.data)
                        return r
                    return ex
                return (lambda *a, **k: Q(v(*a, **k))) if callable(v) else v

        class C:
            def table(self, name):
                t = real.table(name)
                return Q(t) if name == "fingerprints" else t

            def __getattr__(self, attr):
                return getattr(real, attr)

        return C()

    @contextlib.contextmanager
    def install(self):
        mods = [m for m in (database, recognizer) if hasattr(m, "get_client")]
        origs = {m: m.get_client for m in mods}
        for m in mods:
            m.get_client = (lambda o: (lambda: self.wrap(o())))(origs[m])
        try:
            yield self
        finally:
            for m, o in origs.items():
                m.get_client = o

    def summary(self):
        return {
            "n_requests": len(self.sizes),
            "capped_requests": sum(s >= PG_MAX_ROWS for s in self.sizes),
            "max_rows_in_request": max(self.sizes, default=0),
        }


def run_identify(clip_path):
    """POST /identify, minus HTTP: the frontend always uploads as 'clip.webm'."""
    fd, tmp = tempfile.mkstemp(suffix=".webm")
    os.close(fd)
    with open(clip_path, "rb") as src, open(tmp, "wb") as dst:
        dst.write(src.read())
    wav = None
    cap, spy = Capture(), RequestSpy()
    t0 = time.time()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            wav = main.convert_to_wav(tmp)
            with cap.patch(main, "fingerprint", "query_fingerprints"), spy.install():
                try:
                    answer = main.run_recognition(wav)
                except HTTPException as e:
                    answer = {"error": f"{e.status_code} {e.detail}"}
    finally:
        for p in {tmp, wav}:
            if p and os.path.exists(p):
                os.unlink(p)
    hashes = cap.hashes or []
    return {
        "answer": answer,
        "candidates": per_song_best(votes_identify(hashes, cap.rows)),
        "n_hashes": len(hashes),
        "n_unique": len({h for h, _ in hashes}),
        "n_rows": len(cap.rows),  # rows the backend actually voted with
        **spy.summary(),
        "secs": time.time() - t0,
    }


def run_ws(clip_path):
    """WS /ws/recognize final query: the whole buffer as one WebM blob."""
    data = open(clip_path, "rb").read()
    cap, spy = Capture(), RequestSpy()
    has_shared_lookup = hasattr(recognizer, "query_fingerprints")
    t0 = time.time()
    with contextlib.redirect_stdout(io.StringIO()):
        patches = cap.patch(recognizer, "fingerprint", "query_fingerprints" if has_shared_lookup else None)
        with patches, spy.install():
            try:
                hashes = recognizer.fingerprint_buffer(data)
                answer = recognizer.query_hashes(hashes) or {"error": "no_match"}
            except Exception as e:  # what the WS handler would hit
                hashes, answer = cap.hashes or [], {"error": f"{type(e).__name__}: {e}"}
    # Rows the backend voted with: via the shared lookup if it uses one, else its own requests.
    rows = cap.rows if has_shared_lookup else spy.rows
    # Old recognizer kept hashes[:500]; the current one queries every (deduplicated) hash.
    queried = set(cap.query_inputs[0]) if cap.query_inputs else None
    n_used = len(hashes) if queried == {h for h, _ in hashes} else min(len(hashes), 500)
    return {
        "answer": answer,
        "candidates": per_song_best(votes_ws(hashes[:n_used], rows)),
        "n_hashes": len(hashes),
        "n_used": n_used,
        "n_rows": len(rows),
        **spy.summary(),
        "secs": time.time() - t0,
    }


# ─────────────────────────────────────────────
# Reporting
# ─────────────────────────────────────────────

def answer_id(res):
    return res["answer"].get("song_id")


def describe(res, expected_id, start, top=5):
    a = res["answer"]
    verdict = "MATCH" if answer_id(res) == expected_id else "MISS"
    lines = [f"  backend answer: {a.get('title', a.get('error'))}  -> {verdict}"]
    extra = f"used {res['n_used']}, " if "n_used" in res else f"{res['n_unique']} unique, "
    lines.append(
        f"  clip hashes: {res['n_hashes']} ({extra}DB rows {res['n_rows']} in {res['n_requests']} requests, "
        f"max {res['max_rows_in_request']}/request, {res['capped_requests']} at the {PG_MAX_ROWS}-row cap)  "
        f"[{res['secs']:.1f}s]"
    )
    for n, sid, delta in res["candidates"][:top]:
        mark = "*" if sid == expected_id else " "
        lines.append(f"   {mark} {n:5d} votes  offset {delta * HOP_SECONDS:7.2f}s  {title(sid)}")
    if expected_id is not None:
        lines.append(f"     (true offset {start:.2f}s)")
    return "\n".join(lines)


def make_clip(path, start, duration, gain_db, snr_db, fmt, seed=0):
    x, sr = load_segment(path, start, duration)
    return write_clip(degrade(x, gain_db, snr_db, seed), sr, fmt)


def cmd_clip(a):
    expected = a.expect if a.expect is not None else song_id_for_file(a.file)
    print(f"{a.file}  library id={expected}  start={a.start}s dur={a.duration}s "
          f"gain={a.gain}dB snr={a.snr} format={a.format}")
    clip = make_clip(a.file, a.start, a.duration, a.gain, a.snr, a.format)
    try:
        if a.path in ("identify", "both"):
            print("[identify]")
            print(describe(run_identify(clip), expected, a.start))
        if a.path in ("ws", "both"):
            print("[ws]")
            print(describe(run_ws(clip), expected, a.start))
    finally:
        os.unlink(clip)


CONDITIONS = [  # (label, gain dB, SNR dB or None, format)
    ("clean wav", 0, None, "wav"),
    ("clean webm", 0, None, "webm"),
    ("-30dB webm", -30, None, "webm"),
    ("snr 10 webm", 0, 10, "webm"),
    ("snr 3 webm", 0, 3, "webm"),
    ("snr 0 webm", 0, 0, "webm"),
]


def cmd_suite(a):
    files = sorted(
        os.path.join(a.songs_dir, f) for f in os.listdir(a.songs_dir)
        if f.lower().endswith((".mp3", ".wav", ".m4a", ".flac"))
    )
    expected = {f: song_id_for_file(f) for f in files}
    for spec in a.extra:  # "path/to/file.mp3=13" for library songs whose filename differs
        path, sid = spec.rsplit("=", 1)
        expected[path] = int(sid)
    files = [f for f, sid in expected.items() if isinstance(sid, int)]
    if a.limit:
        files = files[: a.limit]
    paths = ["identify", "ws"] if a.path == "both" else [a.path]
    results = defaultdict(list)  # (path, condition) -> [hit bools]
    wrong_answers = Counter()  # (path, condition) -> answers that named the WRONG song
    stats = defaultdict(list)  # path -> [(condition, true-song votes, best wrong-song votes, any capped request, seconds)]
    misses = []
    for f in files:
        sid = expected[f]
        dur = ffprobe_duration(f)
        starts = [s for s in np.arange(5, dur - a.duration - 1, a.step)][: a.clips_per_song]
        print(f"\n== {os.path.basename(f)}  (id {sid}, {dur:.0f}s, {len(starts)} clips)")
        for label, gain, snr, fmt in CONDITIONS:
            for start in starts:
                clip = make_clip(f, float(start), a.duration, gain, snr, fmt, seed=int(start))
                try:
                    for p in paths:
                        if p == "ws" and fmt != "webm":
                            continue
                        res = run_identify(clip) if p == "identify" else run_ws(clip)
                        hit = answer_id(res) == sid
                        results[(p, label)].append(hit)
                        if answer_id(res) not in (None, sid):
                            wrong_answers[(p, label)] += 1
                        right = next((n for n, s, _ in res["candidates"] if s == sid), 0)
                        wrong = next((n for n, s, _ in res["candidates"] if s != sid), 0)
                        stats[p].append((label, right, wrong, res["capped_requests"] > 0, res["secs"]))
                        if not hit:
                            misses.append((p, label, os.path.basename(f), float(start), res, sid))
                        if a.verbose or not hit:
                            print(f"[{p} | {label} | start {start:.0f}s]")
                            print(describe(res, sid, float(start), top=3))
                finally:
                    os.unlink(clip)

    print("\n================ MATCH RATE ================")
    for p in paths:
        for label, *_ in CONDITIONS:
            hits = results.get((p, label))
            if hits:
                print(f"  {p:8s} {label:12s} {sum(hits):3d}/{len(hits):<3d}  {100 * sum(hits) / len(hits):5.1f}%"
                      f"   wrong song: {wrong_answers[(p, label)]}")
    total = [h for v in results.values() for h in v]
    print(f"  overall  {sum(total)}/{len(total)}  {100 * sum(total) / max(1, len(total)):.1f}%"
          f"   wrong song: {sum(wrong_answers.values())}")

    print("\n================ VOTES (for picking a threshold) ================")
    for p in paths:
        rows = stats[p]
        wrong = sorted(w for _, _, w, _, _ in rows)
        secs = sorted(t for *_, t in rows)
        print(f"  {p:8s} best wrong-song votes: max {wrong[-1]}, median {wrong[len(wrong) // 2]}  "
              f"| trials with a capped DB request: {sum(c for _, _, _, c, _ in rows)}/{len(rows)}  "
              f"| seconds: median {secs[len(secs) // 2]:.1f}, max {secs[-1]:.1f}")
        for label, *_ in CONDITIONS:
            right = sorted(r for l, r, _, _, _ in rows if l == label)
            matched = sorted(r for l, r, w, _, _ in rows if l == label and r > w)
            if right:
                print(f"           {label:12s} true-song votes: min {right[0]:4d}  median {right[len(right) // 2]:4d}"
                      f"  | lowest when it beat every wrong song: {matched[0] if matched else '-'}")


def cmd_params(a):
    """Suspect 4: does the query pipeline produce the same fingerprints the DB stored?"""
    sid = song_id_for_file(a.file)
    client = database.get_client()
    # Filtering on song_id alone hits Supabase's statement timeout (no index on it),
    # so fetch this song's rows through the hash index instead, in chunks small
    # enough to stay under the row cap (asserted below).
    def stored_rows_for(hash_vals):
        out, chunk = set(), 50
        hash_vals = sorted(set(hash_vals))
        for i in range(0, len(hash_vals), chunk):
            batch = (client.table("fingerprints").select("hash, time_offset")
                     .in_("hash", hash_vals[i:i + chunk]).eq("song_id", sid).execute().data)
            assert len(batch) < PG_MAX_ROWS, "chunk hit the row cap; lower chunk size"
            out |= {(r["hash"], r["time_offset"]) for r in batch}
        return out

    try:  # also a song_id scan; can time out under load — it's only context
        stored_total = (client.table("fingerprints").select("hash", count="exact")
                        .eq("song_id", sid).limit(1).execute().count)
    except Exception:
        stored_total = "unknown (count timed out)"
    with contextlib.redirect_stdout(io.StringIO()):
        direct = set(fp.fingerprint(a.file))  # how scripts/ingest.py stores songs
        fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(a.file)[1])
        os.close(fd)
        with open(a.file, "rb") as s, open(tmp, "wb") as d:
            d.write(s.read())
        wav = main.convert_to_wav(tmp)  # how /add and /identify read audio
        via_ffmpeg = set(fp.fingerprint(wav))
        for p in {tmp, wav}:
            os.unlink(p)
    stored = stored_rows_for([h for h, _ in direct | via_ffmpeg])

    def overlap(x, y):
        return f"{len(x & y)}/{len(x)} ({100 * len(x & y) / max(1, len(x)):.1f}%)"

    print(f"{a.file}  id={sid}")
    print(f"  stored in DB                 : {stored_total} rows "
          f"({len(stored)} of them share a hash with the recomputed sets)")
    print(f"  librosa direct (ingest.py)   : {len(direct)}   in DB: {overlap(direct, stored)}")
    print(f"  ffmpeg->wav (/add, /identify): {len(via_ffmpeg)}   in DB: {overlap(via_ffmpeg, stored)}")
    print(f"  ffmpeg vs direct             : {overlap(via_ffmpeg, direct)}")
    print(f"  params: SAMPLE_RATE={fp.SAMPLE_RATE} n_fft=2048 hop=512 (librosa defaults) "
          f"PEAK_NEIGHBOURHOOD_SIZE={fp.PEAK_NEIGHBOURHOOD_SIZE} AMP_MIN={fp.AMP_MIN} FAN_VALUE={fp.FAN_VALUE}")


def main_cli():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("clip", help="run one clip and show the top candidates")
    c.add_argument("file")
    c.add_argument("--start", type=float, default=30.0)
    c.add_argument("--duration", type=float, default=10.0)
    c.add_argument("--gain", type=float, default=0.0, help="volume change in dB (e.g. -30)")
    c.add_argument("--snr", type=float, default=None, help="add white noise at this SNR in dB")
    c.add_argument("--format", choices=["wav", "webm"], default="wav")
    c.add_argument("--path", choices=["identify", "ws", "both"], default="both")
    c.add_argument("--expect", type=int, default=None, help="library song id, if the filename doesn't match")

    s = sub.add_parser("suite", help="match-rate table over every local library file")
    s.add_argument("--songs-dir", default=SONGS_DIR)
    s.add_argument("--duration", type=float, default=10.0)
    s.add_argument("--step", type=float, default=20.0, help="seconds between clip start points")
    s.add_argument("--clips-per-song", type=int, default=6)
    s.add_argument("--limit", type=int, default=0, help="max songs (0 = all)")
    s.add_argument("--extra", action="append", default=[], metavar="FILE=ID",
                   help="extra audio file and its library song id (repeatable)")
    s.add_argument("--path", choices=["identify", "ws", "both"], default="both")
    s.add_argument("-v", "--verbose", action="store_true", help="print every trial, not just misses")

    p = sub.add_parser("params", help="compare stored fingerprints with what the query pipeline computes")
    p.add_argument("file")

    a = ap.parse_args()
    {"clip": cmd_clip, "suite": cmd_suite, "params": cmd_params}[a.cmd](a)


if __name__ == "__main__":
    main_cli()

"""
WaveJack WebSocket streaming harness: time to first match, in real time.

Plays clips from library songs to a RUNNING backend's /ws/recognize the way the
browser does: one WebM/Opus stream, sent in pieces every `--timeslice` seconds
(like MediaRecorder.start(timeslice)), then {"type": "done"} after 10 s. Records
when the backend answers, what it answered, and whether that was right.

Clips are made with the same helpers as recognition_harness.py (same songs,
start points, noise and encoding), so results line up with that harness.

Usage (backend running, repo root, backend venv):
  python scripts/ws_stream_harness.py --url ws://127.0.0.1:8002 --timeslice 1 \
      --extra "C:\\path\\Bebo.mp3=13"
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from collections import defaultdict

import numpy as np
import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recognition_harness as rh  # noqa: E402  (clip generation + library lookup)

RECORD_SECONDS = 10
UI_GIVES_UP_AFTER = RECORD_SECONDS + 0.5 + 20  # index.tsx: done after 10.5 s, then a 20 s timeout

CONDITIONS = [  # (label, gain dB, SNR dB or None)
    ("clean", 0, None),
    ("snr 10", 0, 10),
    ("snr 3", 0, 3),
    ("snr 0", 0, 0),
]


def stream_pieces(webm: bytes, timeslice: float) -> list[bytes]:
    """
    Cut one continuous WebM stream into the pieces MediaRecorder would emit:
    one per `timeslice` seconds of audio, by byte position (Opus at a fixed
    bitrate is close to constant bytes per second; the backend only ever decodes
    the concatenation, so piece boundaries don't need to align with clusters).
    """
    n = int(round(RECORD_SECONDS / timeslice))
    cuts = [round(len(webm) * k / n) for k in range(n + 1)]
    return [webm[cuts[k]:cuts[k + 1]] for k in range(n)]


async def one_trial(url: str, pieces: list[bytes], timeslice: float) -> dict:
    t0 = time.perf_counter()
    first = {"status": None, "title": None, "song_id": None, "at": None}
    async with websockets.connect(f"{url}/ws/recognize", max_size=None) as ws:
        async def sender():
            for i, piece in enumerate(pieces):
                # piece i holds audio up to (i+1)*timeslice; it's available then
                await asyncio.sleep(max(0.0, t0 + (i + 1) * timeslice - time.perf_counter()))
                if first["status"]:
                    return  # the browser stops recording once it has an answer
                await ws.send(piece)
            await asyncio.sleep(max(0.0, t0 + RECORD_SECONDS + 0.5 - time.perf_counter()))
            if not first["status"]:
                await ws.send(json.dumps({"type": "done"}))

        async def receiver():
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("status") in ("match", "no_match", "error"):
                    first["status"] = msg["status"]
                    first["at"] = time.perf_counter() - t0
                    res = msg.get("result") or {}
                    first["title"], first["song_id"] = res.get("title") or msg.get("detail"), res.get("song_id")
                    return

        send_task = asyncio.create_task(sender())
        try:
            await asyncio.wait_for(receiver(), timeout=UI_GIVES_UP_AFTER + 5)
        except asyncio.TimeoutError:
            first["status"] = "timeout"
        except websockets.ConnectionClosed:
            first["status"] = first["status"] or "closed"
        send_task.cancel()
    return first


async def run(a):
    files = sorted(
        os.path.join(a.songs_dir, f) for f in os.listdir(a.songs_dir)
        if f.lower().endswith((".mp3", ".wav", ".m4a", ".flac"))
    )
    expected = {f: rh.song_id_for_file(f) for f in files}
    for spec in a.extra:
        path, sid = spec.rsplit("=", 1)
        expected[path] = int(sid)
    files = [f for f, sid in expected.items() if isinstance(sid, int)]

    results = defaultdict(list)  # condition -> [(status, correct, seconds)]
    print(f"url={a.url} timeslice={a.timeslice}s  UI gives up at {UI_GIVES_UP_AFTER:.1f}s")
    for f in files:
        sid = expected[f]
        dur = rh.ffprobe_duration(f)
        starts = [s for s in np.arange(5, dur - RECORD_SECONDS - 1, a.step)][: a.clips_per_song]
        print(f"\n== {os.path.basename(f)} (id {sid}, {len(starts)} clips)")
        for label, gain, snr in CONDITIONS:
            for start in starts:
                clip = rh.make_clip(f, float(start), RECORD_SECONDS, gain, snr, "webm", seed=int(start))
                try:
                    pieces = stream_pieces(open(clip, "rb").read(), a.timeslice)
                finally:
                    os.unlink(clip)
                r = await one_trial(a.url, pieces, a.timeslice)
                correct = r["status"] == "match" and r["song_id"] == sid
                wrong = r["status"] == "match" and r["song_id"] != sid
                in_time = r["at"] is not None and r["at"] <= UI_GIVES_UP_AFTER
                results[label].append((r["status"], correct, wrong, r["at"], in_time))
                verdict = "OK " if correct and in_time else ("WRONG" if wrong else "miss")
                at = f"{r['at']:5.1f}s" if r["at"] is not None else "  -  "
                print(f"  [{label:6s} @{start:4.0f}s] {verdict} {r['status']:8s} at {at}  {r['title']}")

    print("\n================ STREAMING RESULTS ================")
    print(f"  {'condition':10s} {'correct':>9s} {'wrong':>6s} {'no match':>9s} {'other':>6s} "
          f"{'time to correct match: median':>30s} {'p90':>6s} {'max':>6s}")
    all_rows = []
    for label, *_ in CONDITIONS:
        rows = results[label]
        all_rows += rows
        times = sorted(at for st, ok, _, at, it in rows if ok and it)
        p90 = times[min(len(times) - 1, int(0.9 * len(times)))] if times else None
        print(f"  {label:10s} {sum(ok and it for _, ok, _, _, it in rows):4d}/{len(rows):<4d} "
              f"{sum(w for _, _, w, _, _ in rows):6d} {sum(st == 'no_match' for st, *_ in rows):9d} "
              f"{sum(st not in ('match', 'no_match') for st, *_ in rows):6d} "
              f"{(f'{statistics.median(times):.1f}s' if times else '-'):>30s} "
              f"{(f'{p90:.1f}s' if p90 else '-'):>6s} {(f'{times[-1]:.1f}s' if times else '-'):>6s}")
    times = sorted(at for st, ok, _, at, it in all_rows if ok and it)
    print(f"  {'overall':10s} {sum(ok and it for _, ok, _, _, it in all_rows):4d}/{len(all_rows):<4d} "
          f"{sum(w for _, _, w, _, _ in all_rows):6d}   median time to correct match "
          f"{statistics.median(times) if times else float('nan'):.1f}s")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="ws://127.0.0.1:8000")
    ap.add_argument("--timeslice", type=float, default=1.0, help="seconds per MediaRecorder piece")
    ap.add_argument("--songs-dir", default=rh.SONGS_DIR)
    ap.add_argument("--extra", action="append", default=[], metavar="FILE=ID")
    ap.add_argument("--step", type=float, default=20.0)
    ap.add_argument("--clips-per-song", type=int, default=6)
    asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    main()

# WaveJack recognition accuracy

Run on 2026-10-09 07:12 against the live library (7 songs) at commit `cfca45b` (plus uncommitted working-tree changes). Total run time 3.2 min, 126 recognitions.

Produced by `scripts/recognition_harness.py accuracy`. The harness calls the backend's own functions (the same code the API runs); no matching, fingerprint or backend code was changed.

## Method

- **Clips:** 3 per song, 10 s each: *start* (from 5 s, skipping any silent intro), *middle* (centred on the midpoint), *end* (finishing 10 s before the end of the track). Decoded with ffmpeg to mono 44.1 kHz float.
- **Conditions:**
  - *clean*: the clip as decoded.
  - *20 dB SNR*: white noise added at 20 dB signal-to-noise ratio.
  - *10 dB SNR, −12 dB*: volume lowered by 12 dB first, then white noise added at 10 dB SNR relative to the quieter signal.
- **Noise:** Gaussian white noise (`numpy.random.default_rng(seed).standard_normal`, flat spectrum across the whole band), scaled so that RMS(signal) / RMS(noise) = 10^(SNR/20), where the signal RMS is measured over the whole 10 s clip. The result is clipped to [−1, 1]. The seed is fixed per clip and condition, so a rerun produces identical audio.
- **Encoding:** every clip is then encoded as Opus in WebM at 128 kb/s, the format the browser's MediaRecorder uploads, and the same file goes through both paths.
- **Paths:**
  - */identify*: `main.convert_to_wav` → `main.run_recognition`, the file-upload endpoint.
  - *WebSocket*: `recognizer.fingerprint_buffer` → `recognizer.query_hashes` on the whole 10 s buffer, i.e. the WebSocket's final full-buffer lookup. The live WebSocket can answer earlier from partial chunks; that early-stop timing is not measured here.
- **Time to match:** wall-clock seconds from handing the clip to the backend function until it answers (decode + fingerprint + database lookup + voting), median over matched clips only. It does not include the 10 s of recording.
- **Outcomes:** *match* = right song; *miss* = no answer (backend said no match); *wrong song* = a different library song was returned.

## Results

Each cell is `/identify · WebSocket` matches out of 3 clips.

| Song | clean | 20 dB SNR | 10 dB SNR, -12 dB | Median time to match (/identify · WS) |
|---|---|---|---|---|
| 1. Love Me Love Me / Sajid-Wajid | not tested | not tested | not tested | not tested (no source file) |
| 2. Tumhe JO Maine Dekha / Abhijeet | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.4 s · 1.3 s |
| 3. Bebo main Bebo / Alisha Chinai | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.0 s · 1.1 s |
| 4. Ladki Badi Anjani Hai / Kumar Sanu | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.1 s · 1.1 s |
| 5. Mujhko Yaad Sataye Teri / Himesh Reshmmiya | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.2 s · 1.3 s |
| 6. Choomantar / Benny Dayal | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.0 s · 1.2 s |
| 7. Callin U / Elyanna | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.0 s · 1.1 s |
| **Total (6 songs)** | **18/18 · 18/18** | **18/18 · 18/18** | **18/18 · 18/18** | **1.1 s · 1.2 s** |

- /identify overall: 54/54 (100%)
- WebSocket overall: 54/54 (100%)

## Wrong matches and false positives

Not-in-library check: `Amit_Kumar;Sonu_Nigam;Alka_Yagnik;Udit_Narayan;Kavita_Krishnamurthy.mp3` ("Bole Chudiyan"), 18 recognitions, expected answer: no match. Correctly rejected: 18/18.

**None.** No clip was identified as a different library song, and the not-in-library song was never matched to anything.

## Misses

None.
## Notes

- **Margins.** A match needs at least 15 votes (`MIN_MATCH_VOTES`). The lowest winning score in this run was **16 votes** (Mujhko Yaad Sataye Teri, *start* clip, 10 dB SNR / −12 dB, WebSocket path), and every result under 40 votes came from a *start* clip (Tumhe Jo Maine Dekha, Mujhko Yaad Sataye Teri, Choomantar). Middle and end clips scored roughly 130–470 votes. Song intros are the weak spot: one more step of noise there would probably turn these into misses (not wrong answers).
- **Wrong-song votes stayed low.** The best wrong song never got more than 10 votes on any library clip, and at most 4 on the not-in-library song, so there is a clear gap below the 15-vote threshold.
- **Sample size.** 6 songs × 3 clips is a small sample; 100% here means "no failures seen", not a guaranteed rate.
- **First-call latency.** The very first recognition took 28.5 s (cold database connection); it is included in the medians but barely moves them.
- **Not covered:** song 1 (no source file), real microphone recordings (room echo, speaker colouring), and the live WebSocket's early-stop timing.

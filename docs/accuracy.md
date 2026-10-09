# WaveJack recognition accuracy

Run on 2026-10-09 18:04 against the live library (14 songs) at commit `68f4c89` (plus uncommitted working-tree changes). Total run time 5.0 min, 252 recognitions.

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
| 2. Tumhe JO Maine Dekha / Abhijeet | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.2 s · 1.2 s |
| 3. Bebo main Bebo / Alisha Chinai | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.8 s · 1.2 s |
| 4. Ladki Badi Anjani Hai / Kumar Sanu | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.0 s · 0.9 s |
| 5. Mujhko Yaad Sataye Teri / Himesh Reshmmiya | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 1.0 s · 1.0 s |
| 6. Choomantar / Benny Dayal | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.9 s · 1.0 s |
| 7. Callin U / Elyanna | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.8 s · 1.0 s |
| 8. Haule Haule / Sukhwinder Singh | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.9 s · 1.0 s |
| 9. Isq Risk / Rahat Fateh Ali  | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.9 s · 0.8 s |
| 10. Zaalima | Raees | Shah Rukh  / Arijit Singh & H | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.9 s · 1.0 s |
| 11. For A Reason / Karan Aujla | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.8 s · 1.0 s |
| 14. Despacito / Luis Fonsi | 2/3 · 2/3 | 2/3 · 2/3 | 2/3 · 2/3 | 0.8 s · 0.9 s |
| 15. Baby Calm Down / Selena Gomez & R | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.9 s · 0.9 s |
| 16. MILLIONAIRE / YO YO HONEY SING | 3/3 · 3/3 | 3/3 · 3/3 | 3/3 · 3/3 | 0.8 s · 0.9 s |
| **Total (13 songs)** | **38/39 · 38/39** | **38/39 · 38/39** | **38/39 · 38/39** | **0.9 s · 1.0 s** |

- /identify overall: 114/117 (97%)
- WebSocket overall: 114/117 (97%)

## Wrong matches and false positives

Not-in-library check: `Amit_Kumar;Sonu_Nigam;Alka_Yagnik;Udit_Narayan;Kavita_Krishnamurthy.mp3` ("Bole Chudiyan"), 18 recognitions, expected answer: no match. Correctly rejected: 18/18.

**None.** No clip was identified as a different library song, and the not-in-library song was never matched to anything.

## Misses

| Clip | Condition | Path | Votes for the true song | Best other song |
|---|---|---|---|---|
| Despacito / Luis Fonsi @ 5s (start) | clean | identify | 12 | 4 (Mujhko Yaad Sataye Teri / Himesh Reshmmiya) |
| Despacito / Luis Fonsi @ 5s (start) | clean | ws | 10 | 4 (Mujhko Yaad Sataye Teri / Himesh Reshmmiya) |
| Despacito / Luis Fonsi @ 5s (start) | 20 dB SNR | identify | 12 | 5 (Mujhko Yaad Sataye Teri / Himesh Reshmmiya) |
| Despacito / Luis Fonsi @ 5s (start) | 20 dB SNR | ws | 10 | 5 (Mujhko Yaad Sataye Teri / Himesh Reshmmiya) |
| Despacito / Luis Fonsi @ 5s (start) | 10 dB SNR, -12 dB | identify | 11 | 4 (Zaalima | Raees | Shah Rukh  / Arijit Singh & H) |
| Despacito / Luis Fonsi @ 5s (start) | 10 dB SNR, -12 dB | ws | 8 | 3 (Love Me Love Me / Sajid-Wajid) |

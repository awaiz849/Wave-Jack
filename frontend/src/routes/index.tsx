import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, LogOut, AlertCircle, Mic } from "lucide-react";
import { MicOrb, LiveWaveform } from "@/components/wavejack/Visuals";
import { StatsRow, useLibraryStats } from "@/components/wavejack/LibraryStats";
import { PageShell } from "@/components/wavejack/PageShell";
import { API_URL, WS_URL } from "@/lib/config";
import {
  AuthModal,
  LimitModal,
  useAuth,
  signOut,
  getGuestUses,
  incGuestUses,
  addHistory,
  addHistoryDB,
} from "@/components/wavejack/Auth";
import { RecentSearches, artFor, type Track } from "@/components/wavejack/RecentSearches";
import { ResultCard } from "@/components/wavejack/ResultCard";
import { MicDebugPanel, type MicDebugSent } from "@/components/wavejack/MicDebugPanel";
import {
  MicPicker,
  loadMicChoice,
  saveMicChoice,
  useAudioInputs,
} from "@/components/wavejack/MicPicker";

// "No sound" check: the loudest level in the first SILENCE_CHECK_MS of a recording
// must reach SILENCE_DBFS, or we tell the user to pick another microphone.
const SILENCE_CHECK_MS = 2000;
const SILENCE_DBFS = -70;

// TEMPORARY: the mic debug panel and playback only exist in `vite dev`, never in a build.
const DEV = import.meta.env.DEV;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WaveJack — Identify any song in seconds" },
      {
        name: "description",
        content: "Tap, drop, or record audio and WaveJack tells you the song.",
      },
    ],
  }),
  component: WaveJack,
});

type AppState = "idle" | "listening" | "processing" | "result" | "error";

type IdentifyResponse = {
  title: string;
  artist: string;
  confidence: number;
  song_id?: number;
  youtube_url?: string | null; // sent by both /identify and the WebSocket result
  votes?: number; // aligned hashes for the winning song (both paths)
  runner_up_votes?: number; // best other song, 0 if none (both paths)
};

const PIPELINE_STEPS = [
  "▸ ingesting audio stream...",
  "▸ generating fingerprint hashes...",
  "▸ querying acoustic database...",
  "▸ matching hash signatures...",
  "▸ ranking candidates by confidence...",
];

const RECORD_SECONDS = 10;
// No match by the end of the normal recording: keep recording (the backend keeps
// matching every new chunk) for up to this many more seconds before giving up.
const EXTRA_SECONDS = 10;
const NO_MATCH_AFTER_EXTRA =
  "No match. Try again from a louder part of the song, closer to the mic.";

// FIX: mobile networks (carrier NAT, background-tab throttling, screen lock)
// can silently drop a WebSocket or let a fetch hang with no error and no
// close event ever firing. Previously nothing timed the "processing" state
// out, so a dropped connection left the UI stuck on the spinner forever even
// though the backend may have already matched the song. This caps it.
const PROCESSING_TIMEOUT_MS = 20000;

function WaveJack() {
  const [state, setState] = useState<AppState>("idle");
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
  // True during the extra listening time after the first RECORD_SECONDS.
  const [extended, setExtended] = useState(false);
  const extendedRef = useRef(false); // same, for the WebSocket handler (no stale closure)
  const reachedMaxRef = useRef(false); // recording ran the full RECORD_SECONDS + EXTRA_SECONDS
  const { user, loading: authLoading } = useAuth();
  const [guestUses, setGuestUses] = useState(0);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [showLimit, setShowLimit] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Mic recording refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Dev-only mic diagnostics (see MicDebugPanel).
  const [debugStream, setDebugStream] = useState<MediaStream | null>(null);
  const [debugSent, setDebugSent] = useState<MicDebugSent>({ chunks: 0, bytes: 0, mimeType: "" });
  const [debugUrl, setDebugUrl] = useState<string | null>(null);
  const debugChunksRef = useRef<Blob[]>([]);
  // Microphone choice ("" = system default), saved in localStorage.
  const [micId, setMicId] = useState("");
  const { devices: micDevices, refresh: refreshMics } = useAudioInputs();
  const libraryStats = useLibraryStats();
  const [silentMsg, setSilentMsg] = useState<string | null>(null);
  const silenceCheckRef = useRef<{
    ctx: AudioContext;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);

  useEffect(() => {
    setMicId(loadMicChoice());
  }, []);

  const chooseMic = (deviceId: string) => {
    setMicId(deviceId);
    saveMicChoice(deviceId);
  };

  const stopSilenceCheck = () => {
    if (!silenceCheckRef.current) return;
    clearInterval(silenceCheckRef.current.timer);
    silenceCheckRef.current.ctx.close().catch(() => {});
    silenceCheckRef.current = null;
  };

  // Samples the input level every 100 ms; if nothing reaches SILENCE_DBFS within
  // SILENCE_CHECK_MS, the chosen device is almost certainly not hearing anything.
  const startSilenceCheck = (stream: MediaStream) => {
    stopSilenceCheck();
    const label = stream.getAudioTracks()[0]?.label || "this microphone";
    const ctx = new AudioContext();
    ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser); // not routed to the speakers
    const buf = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let loudest = -Infinity;
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      loudest = Math.max(loudest, rms > 0 ? 20 * Math.log10(rms) : -Infinity);
      if (performance.now() - started >= SILENCE_CHECK_MS) {
        if (loudest < SILENCE_DBFS) {
          setSilentMsg(`No sound detected from ${label}. Pick another microphone.`);
        }
        stopSilenceCheck();
      }
    }, 100);
    silenceCheckRef.current = { ctx, timer };
  };
  const wsRef = useRef<WebSocket | null>(null);
  const cdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingForResultRef = useRef(false);
  const matchFoundRef = useRef(false);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Errors stay on screen until the next action — no auto-dismiss timer to race
  // a new recording, and no time limit on reading the message.
  const showError = (msg: string) => {
    setErrorMsg(msg);
    setState("error");
  };

  // FIX: single place that arms/clears the stuck-processing safety net.
  const clearProcessingTimeout = () => {
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
  };
  const armProcessingTimeout = () => {
    clearProcessingTimeout();
    processingTimeoutRef.current = setTimeout(() => {
      waitingForResultRef.current = false;
      wsRef.current?.close();
      showError("Taking too long to respond — the connection may have dropped. Try again.");
    }, PROCESSING_TIMEOUT_MS);
  };
  useEffect(() => {
    setGuestUses(getGuestUses());
  }, []);

  // Pipeline animation
  useEffect(() => {
    if (state !== "processing") return;
    setPipelineStep(0);
    const interval = setInterval(() => {
      setPipelineStep((s) => {
        if (s >= PIPELINE_STEPS.length - 1) {
          clearInterval(interval);
          return s;
        }
        return s + 1;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [state]);

  const checkLimit = (): boolean => {
    if (user) return true;
    if (getGuestUses() >= 2) {
      setShowLimit(true);
      return false;
    }
    return true;
  };

  // ── START MIC RECORDING ──
  const startListening = async () => {
    if (!checkLimit()) return;
    matchFoundRef.current = false;
    waitingForResultRef.current = false;
    extendedRef.current = false;
    reachedMaxRef.current = false;
    setExtended(false);
    setResult(null);
    setErrorMsg(null);
    setSilentMsg(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      // Browsers only expose the mic on https:// or localhost (not e.g. http://192.168.x.x).
      showError("Recording needs a secure page (https or localhost). You can still upload a file.");
      return;
    }
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported("audio/webm")) {
      showError(
        "This browser can't record in the format WaveJack needs yet. Upload a file instead.",
      );
      return;
    }

    let stream: MediaStream;
    try {
      // Browser voice-call processing is on by default and is wrong for music:
      // echo cancellation removes sound this computer is playing, noise
      // suppression treats music as noise, and auto-gain pumps the level.
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: micId ? { ...audio, deviceId: { exact: micId } } : audio,
        });
      } catch (err) {
        // The saved microphone is gone (unplugged, or ids reset): forget it, use the default.
        const name = err instanceof DOMException ? err.name : "";
        if (!micId || (name !== "OverconstrainedError" && name !== "NotFoundError")) throw err;
        chooseMic("");
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      }
      refreshMics(); // labels are only available once access has been granted
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      showError(
        name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it in your browser's site settings, or upload a file."
          : name === "NotFoundError"
            ? "No microphone found. Plug one in, or upload a file instead."
            : "Couldn't start the microphone. Try again, or upload a file instead.",
      );
      return;
    }

    try {
      streamRef.current = stream;
      if (DEV) {
        debugChunksRef.current = [];
        setDebugSent({ chunks: 0, bytes: 0, mimeType: "" });
        setDebugUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return null;
        });
        setDebugStream(stream);
      }
      const ws = new WebSocket(`${WS_URL}/ws/recognize`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status === "match") {
          matchFoundRef.current = true;
          waitingForResultRef.current = false;
          clearProcessingTimeout(); // FIX: real result arrived, cancel the safety net
          // The backend can match early, while we're still recording; stop the
          // countdown too, or it later calls stopListening() and overwrites the result.
          endRecording();
          finalizeResult(data.result);
          // don't close here — let backend close it
        } else if (data.status === "no_match" || data.status === "error") {
          waitingForResultRef.current = false;
          clearProcessingTimeout(); // FIX
          endRecording();
          showError(
            data.status === "no_match"
              ? reachedMaxRef.current
                ? NO_MATCH_AFTER_EXTRA
                : "No match — this song isn't in the library yet."
              : data.detail || "The server couldn't process that recording.",
          );
        }
      };

      ws.onclose = () => {
        clearProcessingTimeout(); // socket is gone either way, no point waiting on it
        if (matchFoundRef.current) return; // result is already on screen
        endRecording();
        if (waitingForResultRef.current) {
          // Closed before answering (server error, dropped connection): say so now
          // rather than leaving the spinner up until the 20 s timeout.
          waitingForResultRef.current = false;
          showError("Lost the connection before the server answered. Try again.");
        } else {
          // Don't overwrite an error or "no match" that's already showing.
          setState((s) => (s === "listening" ? "idle" : s));
        }
      };

      ws.onerror = () => {
        clearProcessingTimeout(); // FIX
        waitingForResultRef.current = false; // onclose follows; this message wins
        endRecording();
        showError("Couldn't reach the recognition server — is the backend running?");
      };

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
          if (DEV) {
            debugChunksRef.current.push(e.data); // exactly the bytes the backend receives
            setDebugSent((s) => ({ ...s, chunks: s.chunks + 1, bytes: s.bytes + e.data.size }));
          }
        }
      };
      if (DEV) {
        setDebugSent((s) => ({ ...s, mimeType: recorder.mimeType }));
        // onstop fires after the last dataavailable, so the recording is complete here.
        recorder.onstop = () => {
          if (debugChunksRef.current.length) {
            const blob = new Blob(debugChunksRef.current, { type: recorder.mimeType });
            setDebugUrl(URL.createObjectURL(blob));
          }
        };
      }

      // Send audio every second: the backend matches as soon as each piece lands
      // and answers early once the evidence is clear (measured: median 4.3 s vs
      // 5.3 s with 2 s pieces, same accuracy). Recording still stops at 10 s.
      recorder.start(1000);
      setState("listening");
      startSilenceCheck(stream);

      let sec = RECORD_SECONDS;
      setCountdown(sec);
      cdTimerRef.current = setInterval(() => {
        sec--;
        if (sec <= 0 && !extendedRef.current) {
          // Normal recording is over and no match has arrived (a match would have
          // cleared this timer): keep the mic and socket open for EXTRA_SECONDS more.
          extendedRef.current = true;
          setExtended(true);
          sec = EXTRA_SECONDS;
        } else if (sec <= 0) {
          reachedMaxRef.current = true;
          stopListening();
          return;
        }
        setCountdown(sec);
      }, 1000);
      // Backstop in case the interval is throttled (background tab): never record past the max.
      stopTimerRef.current = setTimeout(
        () => {
          reachedMaxRef.current = true;
          stopListening();
        },
        (RECORD_SECONDS + EXTRA_SECONDS) * 1000 + 1500,
      );
    } catch (err) {
      console.error("Recording failed to start:", err);
      endRecording();
      wsRef.current?.close();
      showError("Couldn't start recording. Try again, or upload a file instead.");
    }
  };

  // Stops the countdown, the recorder and the mic itself (releases the browser's mic indicator).
  const endRecording = () => {
    if (cdTimerRef.current) {
      clearInterval(cdTimerRef.current);
      cdTimerRef.current = null;
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    stopSilenceCheck();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (DEV) setDebugStream(null); // stops the level meter; the panel keeps the last device info
  };

  // Leaving the page mid-recording: release the mic, timers and socket.
  const endRecordingRef = useRef(endRecording);
  endRecordingRef.current = endRecording;
  useEffect(
    () => () => {
      endRecordingRef.current();
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      wsRef.current?.close();
    },
    [],
  );

  const stopListening = () => {
    endRecording();
    extendedRef.current = false;
    setExtended(false);
    waitingForResultRef.current = true;
    setState("processing");
    armProcessingTimeout(); // FIX: guarantee we leave "processing" even if the socket dies silently
    // give recorder time to flush final chunk then signal done
    setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "done" }));
      }
    }, 500);
  };
  // ── PROCESS AUDIO ──
  const runProcessing = async (file: Blob | File) => {
    setState("processing");
    setErrorMsg(null);
    // FIX: an AbortController timeout so a hung mobile connection can't leave
    // this fetch pending forever with no error and no response.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROCESSING_TIMEOUT_MS);
    try {
      const fd = new FormData();
      fd.append("file", file, "clip.webm");
      const r = await fetch(`${API_URL}/identify`, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.detail || `Server error ${r.status}`);
      }
      const resp: IdentifyResponse = await r.json();
      // normalize confidence (backend returns 0–1, but guard against legacy 0–100)
      if (resp.confidence > 1) resp.confidence = resp.confidence / 100;
      finalizeResult(resp);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      // fetch() rejects with a TypeError ("Failed to fetch") when the server is unreachable.
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "Taking too long to respond — check your connection and try again."
          : err instanceof TypeError || !(err instanceof Error)
            ? "Could not reach the WaveJack API — is the backend running?"
            : err.message;
      console.error("Identify error:", err);
      showError(msg);
    }
  };

  const statusAnnouncement =
    state === "listening"
      ? extended
        ? `No match yet. Still listening for up to ${EXTRA_SECONDS} more seconds.`
        : `Listening for ${RECORD_SECONDS} seconds.`
      : state === "processing"
        ? "Identifying the song…"
        : state === "result" && result
          ? `Matched: ${result.title} by ${result.artist}.`
          : state === "error"
            ? `Identification failed. ${errorMsg ?? ""}`
            : "";

  const finalizeResult = (resp: IdentifyResponse) => {
    clearProcessingTimeout(); // FIX: belt-and-suspenders — never leave the timer armed once we have a result
    setResult(resp);
    setState("result");

    const histItem = {
      title: resp.title,
      artist: resp.artist,
      confidence: resp.confidence,
      votes: resp.votes,
      runner_up_votes: resp.runner_up_votes,
      at: Date.now(),
    };

    addHistory(histItem);
    addHistoryDB(resp.song_id || null, histItem).catch((e) =>
      console.error("[WaveJack] couldn't save search history:", e),
    );

    setTracks((prev) => [
      {
        id: `${resp.title}-${Date.now()}`,
        title: resp.title,
        artist: resp.artist,
        art: artFor(resp.title + resp.artist),
      },
      ...prev,
    ]);

    if (!user) incGuestUses();
  };

  const handleFile = (file: File) => {
    if (!checkLimit()) return;
    setResult(null);
    setErrorMsg(null);
    runProcessing(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // useAuth() picks up the SIGNED_OUT event; nothing to clear by hand.
  const logout = () => {
    signOut().catch((e) => console.error("[WaveJack] sign-out failed:", e));
  };

  const handleOrbClick = () => {
    if (state === "listening") {
      stopListening();
      return;
    }
    if (state === "idle" || state === "error" || state === "result") startListening();
  };

  return (
    <PageShell
      bare
      rightSlot={
        // Render nothing until the stored session is read, so signed-in users
        // don't see "Sign In / Sign Up" flash first.
        authLoading ? null : user ? (
          <>
            <span className="text-sm text-foreground">Hi, {user.name}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
            >
              <LogOut size={14} aria-hidden="true" /> Logout
            </button>
          </>
        ) : (
          <>
            <span className="font-signal mr-1 text-xs text-muted-foreground">
              {Math.max(0, 2 - guestUses)} free left
            </span>
            <button
              onClick={() => setAuthMode("signin")}
              className="rounded-lg border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
            >
              Sign In
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className="bg-gradient-button rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
            >
              Sign Up
            </button>
          </>
        )
      }
    >
      {/* Hero: copy, status, actions and library stats on the left; the
         interactive orb on the right. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-12 pb-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pt-20">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgb(192_132_252/0.25)] bg-[rgb(168_85_247/0.1)] px-3 py-1 text-xs text-accent-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent-2)]" />
            Acoustic fingerprinting
          </span>
          <h1 className="font-display mt-6 text-5xl font-bold leading-[1.02] tracking-tight text-foreground sm:text-7xl">
            Identify Any Song
            <br />
            <span className="text-gradient">In Seconds.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
            Hold your phone up to the music or drop in a clip. WaveJack turns it into a fingerprint
            and matches it against every song in the library.
          </p>

          {/* Screen readers get one short announcement per state change; the
             animated text below changes too often (countdown, pipeline steps). */}
          <p role="status" aria-live="polite" className="sr-only">
            {statusAnnouncement}
          </p>

          <div className="mt-6 min-h-6 max-w-sm" aria-hidden="true">
            <AnimatePresence mode="wait">
              {state === "idle" && (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="font-signal text-sm text-signal">ready</span>
                  <span className="font-signal text-sm text-muted-foreground">
                    {" "}
                    · tap the orb to start
                  </span>
                </motion.div>
              )}
              {state === "listening" && (
                <motion.div
                  key="listening"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="font-signal text-sm text-signal">
                    {extended ? "still listening…" : "listening"} · {countdown}s
                  </span>
                  <span className="font-signal text-sm text-muted-foreground"> · tap to stop</span>
                </motion.div>
              )}
              {state === "processing" && (
                <motion.div
                  key="proc"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="font-signal text-sm text-signal">
                    {PIPELINE_STEPS[pipelineStep]}
                  </div>
                </motion.div>
              )}
              {state === "error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2"
                >
                  <AlertCircle size={15} className="mt-0.5 shrink-0 text-destructive" />
                  <div>
                    <div className="font-signal text-sm text-destructive">
                      identification failed
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{errorMsg}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* The result card has buttons, so it lives outside the aria-hidden status block. */}
          {state === "result" && result && <ResultCard result={result} />}
          {/* Part of the status area, but outside the aria-hidden block so it's announced. */}
          {silentMsg && (
            <p
              role="alert"
              className="mt-3 flex max-w-sm items-start gap-2 text-sm text-destructive"
            >
              <AlertCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              {silentMsg}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={handleOrbClick}
              className="bg-gradient-button glow-pink inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
            >
              <Mic size={16} aria-hidden="true" />
              {state === "listening" ? "Stop Listening" : "Start Listening"}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--card)] px-6 py-3 text-sm text-foreground transition-colors hover:bg-[var(--secondary)]"
            >
              <Upload size={15} aria-hidden="true" /> Upload audio
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              tabIndex={-1}
              aria-label="Audio file to identify"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // so picking the same file again still fires onChange
                if (f) handleFile(f);
              }}
            />
          </div>

          <StatsRow stats={libraryStats} />
        </div>

        {/* Right column: the mic orb doubles as the click target and the
           hero visual. Hidden from assistive tech: the Start Listening
           and Upload buttons are the keyboard/screen-reader equivalents. */}
        <div className="flex flex-col items-center">
          <div
            aria-hidden="true"
            onClick={handleOrbClick}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className="flex cursor-pointer flex-col items-center justify-center"
          >
            <motion.div animate={{ opacity: dragOver ? 0.6 : 1 }}>
              <MicOrb
                state={
                  state === "listening"
                    ? "listening"
                    : state === "processing"
                      ? "processing"
                      : "idle"
                }
                countdown={countdown}
                total={extended ? EXTRA_SECONDS : RECORD_SECONDS}
                extended={extended}
              />
            </motion.div>
            {dragOver && (
              <div className="font-signal mt-4 text-xs text-signal">drop to identify</div>
            )}
          </div>
          <MicPicker
            devices={micDevices}
            value={micId}
            onChange={chooseMic}
            disabled={state === "listening" || state === "processing"}
          />
        </div>
      </div>

      {DEV && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <MicDebugPanel stream={debugStream} sent={debugSent} recordingUrl={debugUrl} />
        </div>
      )}

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 px-4 pb-8 pt-6 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        <RecentSearches tracks={tracks} />
        <div className="panel panel-edge rounded-[var(--radius)] p-5" aria-hidden="true">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-display text-base font-semibold text-foreground">
              Live waveform
            </span>
            <span className="font-signal text-xs text-muted-foreground">
              {state === "listening" ? "recording" : "idle"}
            </span>
          </div>
          <LiveWaveform active={state === "listening"} />
        </div>
        <section
          aria-labelledby="system-status"
          className="panel panel-edge rounded-[var(--radius)] p-5 md:col-span-2 lg:col-span-1"
        >
          <h2
            id="system-status"
            className="font-display mb-4 text-base font-semibold text-foreground"
          >
            System status
          </h2>
          <dl className="space-y-3 text-sm">
            {[
              {
                label: "Recognition API",
                value:
                  libraryStats.status === "ok"
                    ? "online"
                    : libraryStats.status === "loading"
                      ? "checking…"
                      : "unreachable",
                tone:
                  libraryStats.status === "ok"
                    ? "bg-[var(--success)]"
                    : libraryStats.status === "loading"
                      ? "bg-[var(--accent-3)]"
                      : "bg-[var(--destructive)]",
              },
              {
                label: "Microphone",
                value: micDevices.find((d) => d.deviceId === micId)?.label || "system default",
                tone: "bg-[var(--accent-2)]",
              },
              {
                label: "Recognizer",
                value:
                  state === "listening"
                    ? "listening"
                    : state === "processing"
                      ? "matching"
                      : state === "result"
                        ? "matched"
                        : state === "error"
                          ? "failed"
                          : "ready",
                tone: state === "error" ? "bg-[var(--destructive)]" : "bg-[var(--accent)]",
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4">
                <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="flex min-w-0 items-center gap-2 text-foreground">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.tone}`}
                  />
                  <span className="truncate">{row.value}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Footer: the real fingerprinting parameters the backend uses. */}
      <footer className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
        <div className="font-signal flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[var(--border)] bg-[rgb(20_16_29/0.6)] px-4 py-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2 text-foreground">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
            WaveJack
          </span>
          <span>22,050 Hz mono</span>
          <span>STFT 2048 / hop 512</span>
          <span>SHA-1 pair hashes</span>
          <span>time-offset voting</span>
        </div>
      </footer>

      <AuthModal
        mode={authMode}
        onClose={() => setAuthMode(null)}
        onSwitchMode={(m) => setAuthMode(m)}
        onAuth={() => {
          setAuthMode(null);
          setShowLimit(false);
        }}
      />
      <LimitModal
        open={showLimit}
        onClose={() => setShowLimit(false)}
        onSignup={() => {
          setShowLimit(false);
          setAuthMode("signup");
        }}
      />
    </PageShell>
  );
}

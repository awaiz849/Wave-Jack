import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, LogOut, AlertCircle } from "lucide-react";
import { MicOrb, LiveWaveform, WaveformFingerprint } from "@/components/wavejack/Visuals";
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
};

const PIPELINE_STEPS = [
  "▸ ingesting audio stream...",
  "▸ generating fingerprint hashes...",
  "▸ querying acoustic database...",
  "▸ matching hash signatures...",
  "▸ ranking candidates by confidence...",
];

const RECORD_SECONDS = 10;

// FIX: mobile networks (carrier NAT, background-tab throttling, screen lock)
// can silently drop a WebSocket or let a fetch hang with no error and no
// close event ever firing. Previously nothing timed the "processing" state
// out, so a dropped connection left the UI stuck on the spinner forever even
// though the backend may have already matched the song. This caps it.
const PROCESSING_TIMEOUT_MS = 20000;

function WaveJack() {
  const [state, setState] = useState<AppState>("idle");
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
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
              ? "No match — this song isn't in the library yet."
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
        setCountdown(sec);
        if (sec <= 0) stopListening();
      }, 1000);
      stopTimerRef.current = setTimeout(stopListening, RECORD_SECONDS * 1000);
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

  const stopListening = () => {
    endRecording();
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
      ? `Listening for ${RECORD_SECONDS} seconds.`
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
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
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
              className="rounded-full border border-border px-5 py-1.5 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
            >
              Sign In
            </button>
            <button
              onClick={() => setAuthMode("signup")}
              className="rounded-full bg-foreground px-5 py-1.5 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              Sign Up
            </button>
          </>
        )
      }
    >
      {/* Hero — asymmetric two columns: copy + status on the left, the
         interactive orb on the right, echoing the waveform-into-fingerprint
         mark used in the nav. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 px-6 pt-16 pb-10 sm:px-10 lg:grid-cols-2 lg:pt-24">
        <div>
          <h1 className="font-display text-6xl font-semibold leading-[1.05] text-foreground sm:text-7xl">
            Identify
            <br />
            Any Song
          </h1>

          {/* Screen readers get one short announcement per state change; the
             animated text below changes too often (countdown, pipeline steps). */}
          <p role="status" aria-live="polite" className="sr-only">
            {statusAnnouncement}
          </p>

          <div className="hairline-t mt-8 max-w-sm pt-5" aria-hidden="true">
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
                  <span className="font-signal text-sm text-signal">listening · {countdown}s</span>
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
              {state === "result" && result && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="font-signal text-sm text-signal">
                    matched · {Math.round(result.confidence * 100)}% confidence
                  </div>
                  <div className="font-display mt-2 text-2xl font-semibold text-foreground">
                    {result.title}
                  </div>
                  <div className="text-base text-muted-foreground">{result.artist}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="hairline-t mt-6 flex flex-wrap items-center gap-4 pt-6">
            <button
              onClick={handleOrbClick}
              className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90"
            >
              {state === "listening" ? "Stop Listening" : "Start Listening"}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
            >
              <Upload size={15} /> Upload audio
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
        </div>

        {/* Right column: the mic orb doubles as the click target and the
           hero visual — no separate decorative illustration competing with
           it for attention. Hidden from assistive tech: the Start Listening
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
          {silentMsg && (
            <p role="alert" className="mt-2 max-w-xs text-center text-xs text-destructive">
              {silentMsg}
            </p>
          )}
        </div>
      </div>

      {DEV && (
        <div className="px-6 sm:px-10">
          <MicDebugPanel stream={debugStream} sent={debugSent} recordingUrl={debugUrl} />
        </div>
      )}

      {/* The waveform → fingerprint mark, used once here as a section divider
         rather than a repeated decoration. */}
      <div className="mx-auto max-w-6xl px-6 py-4 opacity-70 sm:px-10">
        <WaveformFingerprint className="h-16 w-full" />
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-24 pt-6 sm:px-10 lg:grid-cols-[1fr_auto]">
        <RecentSearches tracks={tracks} />
        <div className="panel w-full rounded-md p-5 lg:w-[380px]" aria-hidden="true">
          <div className="font-signal mb-1 text-xs text-muted-foreground">live waveform</div>
          <LiveWaveform active={state === "listening"} />
        </div>
      </div>

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

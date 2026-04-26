import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, LogOut, AudioWaveform, AlertCircle } from "lucide-react";
import { ParticleField, WaveRibbons, MicOrb, LiveWaveform } from "@/components/wavejack/Visuals";
import {
  AuthModal,
  LimitModal,
  getUser,
  setUser as persistUser,
  getGuestUses,
  incGuestUses,
  addHistory,
  addHistoryDB,
  isAdmin,
  type AuthUser,
} from "@/components/wavejack/Auth";
import { Link } from "@tanstack/react-router";
import { RecentSearches, artFor, type Track } from "@/components/wavejack/RecentSearches";

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

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

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

function WaveJack() {
  const [state, setState] = useState<AppState>("idle");
  const [countdown, setCountdown] = useState(RECORD_SECONDS);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [guestUses, setGuestUses] = useState(0);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [showLimit, setShowLimit] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null); // ← FIX: error state
  const [tracks, setTracks] = useState<Track[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Mic recording refs
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
// keep recorderRef, cdTimerRef, stopTimerRef
// remove chunksRef and streamRef
  const cdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingForResultRef = useRef(false);
  const matchFoundRef = useRef(false);
  useEffect(() => {
  setUser(getUser());
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
  matchFoundRef.current = false;      // ← add
  waitingForResultRef.current = false; // ← add
  setResult(null);
  setErrorMsg(null);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ws = new WebSocket(`${API.replace("http", "ws")}/ws/recognize`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.status === "match") {
    matchFoundRef.current = true;
    waitingForResultRef.current = false;
    finalizeResult(data.result);
    // don't close here — let backend close it
  } else if (data.status === "no_match") {
    waitingForResultRef.current = false;
    setErrorMsg("Song not found in database");
    setState("error");
   
  }
};

ws.onclose = () => {
  if (!matchFoundRef.current && !waitingForResultRef.current) setState("idle");
  matchFoundRef.current = false;
};

ws.onerror = () => {
  setErrorMsg("WebSocket error — is the backend running?");
  setState("error");
  setTimeout(() => { setState("idle"); setErrorMsg(null); }, 5000);
};



    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data);
      }
    };

    recorder.start(2000); // send a chunk every 2s
    setState("listening");

    let sec = RECORD_SECONDS;
    setCountdown(sec);
    cdTimerRef.current = setInterval(() => {
      sec--;
      setCountdown(sec);
      if (sec <= 0) stopListening();
    }, 1000);
    stopTimerRef.current = setTimeout(stopListening, RECORD_SECONDS * 1000);

  } catch {
    alert("Microphone access denied.");
  }
};

  const stopListening = () => {
  if (cdTimerRef.current) { clearInterval(cdTimerRef.current); cdTimerRef.current = null; }
  if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  if (recorderRef.current && recorderRef.current.state !== "inactive") {
    recorderRef.current.stop();
  }
  waitingForResultRef.current = true;
  setState("processing");
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
    try {
      const fd = new FormData();
      fd.append("file", file, "clip.webm");
      const r = await fetch(`${API}/identify`, { method: "POST", body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.detail || `Server error ${r.status}`);
      }
      const resp: IdentifyResponse = await r.json();
      // normalize confidence (backend returns 0–1, but guard against legacy 0–100)
      if (resp.confidence > 1) resp.confidence = resp.confidence / 100;
      finalizeResult(resp);
    } catch (err: unknown) {
      // ── FIX: show the error to the user instead of silently resetting ──
      const msg =
        err instanceof Error
          ? err.message
          : "Could not reach the WaveJack API — is the backend running?";
      console.error("Identify error:", err);
      setErrorMsg(msg);
      setState("error");
      // Auto-clear after 5 s so the user can try again
      setTimeout(() => {
        setState("idle");
        setErrorMsg(null);
      }, 5000);
    }
  };

  const finalizeResult = (resp: IdentifyResponse) => {
    setResult(resp);
    setState("result");

    const histItem = {
      title: resp.title,
      artist: resp.artist,
      confidence: resp.confidence,
      at: Date.now(),
    };

    addHistory(histItem);
    addHistoryDB(resp.song_id || null, histItem);

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

  const logout = () => {
    persistUser(null);
    setUser(null);
  };

  const handleOrbClick = () => {
  if (state === "listening") {
    stopListening();
    return;
  }
  if (state === "idle" || state === "error" || state === "result") startListening();
};

  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticleField />
      <WaveRibbons />

      {/* Navbar */}
      <nav className="relative z-20 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{
              background: "var(--gradient-purple)",
              boxShadow: "0 0 20px oklch(0.62 0.22 295 / 0.6)",
            }}
          >
            <AudioWaveform size={20} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">WaveJack</span>
        </div>

        <div className="hidden items-center gap-8 md:flex">
          <Link to="/" className="text-sm text-white hover:text-white/80">
            Home
          </Link>
          <Link to="/history" className="text-sm text-white/60 hover:text-white">
            History
          </Link>
          <Link to="/discover" className="text-sm text-white/60 hover:text-white">
            Discover
          </Link>
          {isAdmin(user) && (
            <Link to="/admin" className="text-sm text-cyan hover:text-white">
              Admin
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-white">Hi, {user.name}</span>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-1.5 text-sm text-white hover:bg-white/5"
              >
                <LogOut size={14} /> Logout
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-white/40 mr-1">
                {Math.max(0, 2 - guestUses)} free left
              </span>
              <button
                onClick={() => setAuthMode("signin")}
                className="rounded-full border border-white/30 px-5 py-1.5 text-sm text-white hover:bg-white/5"
              >
                Sign In
              </button>
              <button
                onClick={() => setAuthMode("signup")}
                className="rounded-full bg-white px-5 py-1.5 text-sm font-semibold text-black hover:bg-white/90"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Main */}
      <main className="relative z-10 flex flex-col items-center justify-center px-4 pt-4 pb-40">
        <div onClick={handleOrbClick} className="cursor-pointer">
          <MicOrb
            state={
              state === "result"
                ? "idle"
                : state === "processing"
                  ? "processing"
                  : state === "listening"
                    ? "listening"
                    : "idle"
            }
            countdown={countdown}
          />
        </div>

        <div className="mt-2 text-center">
          <AnimatePresence mode="wait">
            {state === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="text-sm uppercase tracking-[0.3em] text-white/60">
                  tap to identify
                </div>
                <div className="mt-1 text-5xl font-bold text-white">Ready</div>
              </motion.div>
            )}
            {state === "listening" && (
              <motion.div
                key="listening"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="text-sm uppercase tracking-[0.3em] text-white/60">
                  listening — tap to stop
                </div>
                <div className="mt-1 text-5xl font-bold text-white">{countdown}s</div>
              </motion.div>
            )}
            {state === "processing" && (
              <motion.div
                key="proc"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="font-mono text-left"
              >
                <div className="text-xs uppercase tracking-[0.3em] text-cyan">processing</div>
                <div className="mt-2 space-y-1">
                  {PIPELINE_STEPS.slice(0, pipelineStep + 1).map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-xs text-white/70"
                    >
                      {s}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
            {/* ── FIX: error state is now visible to the user ── */}
            {state === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <div className="flex items-center gap-2 text-red-400">
                  <AlertCircle size={18} />
                  <span className="text-sm uppercase tracking-[0.2em]">identification failed</span>
                </div>
                <div className="max-w-xs text-sm text-white/60">{errorMsg}</div>
                <div className="text-xs text-white/30">tap the orb to try again</div>
              </motion.div>
            )}
            {state === "result" && result && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 18 }}
              >
                <div className="text-xs uppercase tracking-[0.3em] text-cyan">match found</div>
                <div className="mt-1 text-4xl font-bold text-gradient-wave">{result.title}</div>
                <div className="mt-1 text-lg text-white/70">{result.artist}</div>
                
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Upload zone */}
        <motion.div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          animate={{ borderColor: dragOver ? "oklch(0.78 0.16 200)" : "oklch(1 0 0 / 0.2)" }}
          className="mt-10 flex w-[460px] max-w-full items-center justify-between gap-4 rounded-2xl border-2 border-dashed bg-white/[0.03] p-4 backdrop-blur-sm"
        >
          <div className="text-sm text-white/70">Drag &amp; Drop Audio to Identify</div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-105"
            style={{ background: "var(--gradient-purple)", boxShadow: "var(--shadow-glow-purple)" }}
          >
            <Upload size={16} /> Upload
          </button>
        </motion.div>
      </main>

      {/* Bottom-left: Recent Searches */}
      <div className="fixed bottom-6 left-6 z-10 hidden lg:block">
        <RecentSearches tracks={tracks} />
      </div>

      {/* Bottom-right: Live Waveform */}
      <div className="fixed bottom-6 right-6 z-10 hidden lg:block">
        <div className="glass relative w-[400px] rounded-2xl p-5">
          <div
            className="absolute -top-3 right-5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white"
            style={{ background: "var(--gradient-wave)" }}
          >
            Live Waveform
          </div>
          <LiveWaveform active={state === "listening"} />
        </div>
      </div>

      <AuthModal
        mode={authMode}
        onClose={() => setAuthMode(null)}
        onSwitchMode={(m) => setAuthMode(m)}
        onAuth={(u) => {
          setUser(u);
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
    </div>
  );
}

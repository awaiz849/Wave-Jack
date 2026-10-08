import { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * The one recurring visual idea in this design: a waveform trace that
 * resolves into a fingerprint swirl — "sound becomes a fingerprint." Used as
 * hero art on the landing page. Flat, thin single-stroke linework only — no
 * fill, no blur, no glow, matching the rest of the minimal system.
 */
export function WaveformFingerprint({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 560 260"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M0 130 H60 L75 90 L90 170 L105 60 L120 200 L135 100 L150 160 L165 130 H210"
        stroke="var(--accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {Array.from({ length: 11 }, (_, i) => {
        const r = 18 + i * 11;
        return (
          <path
            key={i}
            d={`M ${380 - r} 130 A ${r} ${r * 0.86} 0 1 1 ${380 + r} 130 A ${r} ${r * 0.86} 0 1 1 ${380 - r} 130`}
            stroke="var(--accent)"
            strokeWidth="1.5"
            fill="none"
            opacity={0.35 + i * 0.055}
          />
        );
      })}
    </svg>
  );
}

const BARS = 28;
const idleBars = () => Array.from({ length: BARS }, (_, i) => 0.12 + ((i * 7) % 5) * 0.02);

/**
 * Decorative level meter — random bar heights while listening, a still,
 * low pattern otherwise. (It isn't driven by the real mic signal.)
 */
export function LiveWaveform({ active }: { active: boolean }) {
  const [heights, setHeights] = useState(idleBars);

  useEffect(() => {
    if (!active) {
      setHeights(idleBars());
      return;
    }
    // One plain interval, so the cleanup really stops it. (The old timeout +
    // requestAnimationFrame chain could slip past cleanup and keep running.)
    const id = window.setInterval(
      () => setHeights((h) => h.map(() => Math.random() * 0.85 + 0.15)),
      90,
    );
    return () => window.clearInterval(id);
  }, [active]);

  return (
    <div
      className="flex h-28 items-end justify-center gap-[3px] rounded-xl border border-[var(--border)] bg-black/30 px-3 pb-2 pt-3"
      aria-hidden="true"
    >
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className="w-2 rounded-t-[3px]"
          style={{ background: barColor(i / (heights.length - 1)) }}
          animate={{ height: `${h * 100}%` }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// Violet → pink → amber across the bars, matching --gradient-brand.
const STOPS: [number, number, number][] = [
  [168, 85, 247],
  [236, 72, 153],
  [245, 158, 11],
];
function barColor(t: number) {
  const seg = t < 0.5 ? 0 : 1;
  const k = (t - seg * 0.5) / 0.5;
  const [a, b] = [STOPS[seg], STOPS[seg + 1]];
  const mix = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  return `rgb(${mix.join(" ")})`;
}

interface OrbProps {
  state: "idle" | "listening" | "processing";
  countdown: number;
  /** Length of a recording in seconds; the ring fills over this time. */
  total?: number;
}

// Fixed tick pattern for the spectrum ring (deterministic, so it doesn't jitter on re-render).
const TICKS = Array.from({ length: 96 }, (_, i) => 3 + ((i * 37) % 9) * 0.55);

/**
 * The interactive focal point: concentric rings, a spectrum-tick halo and a soft
 * violet/pink glow around a dark sphere holding the mic. The outer arc fills as
 * the countdown runs. Motion follows prefers-reduced-motion via <MotionConfig>.
 */
export function MicOrb({ state, countdown, total = 10 }: OrbProps) {
  const isListening = state === "listening";
  const isProcessing = state === "processing";
  // Percent of the ring to draw (pathLength=100, so it holds at any size).
  const progress = isListening ? ((total - countdown) / total) * 100 : 0;
  const title = isListening ? "Listening" : isProcessing ? "Identifying" : "Tap to listen";
  const subtitle = isListening
    ? `${countdown}s · tap to stop`
    : isProcessing
      ? "matching fingerprints"
      : "or drop an audio file";

  return (
    <div
      className="relative flex h-[280px] w-[280px] items-center justify-center sm:h-[340px] sm:w-[340px]"
      aria-hidden="true"
    >
      {/* Ambient glow */}
      <div
        className="absolute inset-[4%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgb(168 85 247 / 0.45) 0%, rgb(236 72 153 / 0.25) 45%, transparent 70%)",
          filter: "blur(28px)",
          opacity: isListening ? 0.95 : 0.6,
          transition: "opacity 0.4s ease",
        }}
      />
      {/* Concentric hairline rings */}
      <div className="absolute -inset-[12%] rounded-full border border-white/[0.04]" />
      <div className="absolute inset-0 rounded-full border border-[rgb(245_158_11/0.22)]" />

      {/* Spectrum ticks */}
      <motion.svg
        viewBox="0 0 100 100"
        className="absolute inset-[7%] h-[86%] w-[86%]"
        animate={
          isProcessing ? { rotate: 360 } : isListening ? { scale: [1, 1.03, 1] } : { rotate: 0 }
        }
        transition={
          isProcessing
            ? { duration: 6, repeat: Infinity, ease: "linear" }
            : { duration: 1.2, repeat: isListening ? Infinity : 0, ease: "easeInOut" }
        }
      >
        <defs>
          <linearGradient id="orb-ticks" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="55%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        {TICKS.map((len, i) => {
          const a = (i / TICKS.length) * Math.PI * 2;
          const r1 = 40;
          const r2 = r1 + len * (isListening ? 1.25 : 1);
          return (
            <line
              key={i}
              x1={50 + r1 * Math.cos(a)}
              y1={50 + r1 * Math.sin(a)}
              x2={50 + r2 * Math.cos(a)}
              y2={50 + r2 * Math.sin(a)}
              stroke="url(#orb-ticks)"
              strokeWidth="0.55"
              strokeLinecap="round"
              opacity={0.75}
            />
          );
        })}
      </motion.svg>

      {/* Countdown arc */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
        <defs>
          <linearGradient id="orb-progress" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="49.4"
          fill="none"
          stroke="url(#orb-progress)"
          opacity={progress > 0 ? 1 : 0}
          strokeWidth="1"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${progress} 100`}
          style={{ transition: "stroke-dasharray 0.3s linear" }}
        />
      </svg>

      {/* Sphere */}
      <motion.div
        className="glow-violet relative flex h-[56%] w-[56%] flex-col items-center justify-center rounded-full border border-white/10"
        style={{
          background: "radial-gradient(circle at 35% 28%, #241c34 0%, #120e1b 55%, #0b0812 100%)",
        }}
        animate={isListening ? { scale: [1, 1.025, 1] } : { scale: 1 }}
        transition={{ duration: 1.6, repeat: isListening ? Infinity : 0, ease: "easeInOut" }}
      >
        <span className="bg-gradient-icon glow-pink flex h-14 w-14 items-center justify-center rounded-2xl p-[1.5px]">
          <span
            className="flex h-full w-full items-center justify-center rounded-[14px]"
            style={{ background: isListening ? "transparent" : "#120e1b" }}
          >
            <MicIcon />
          </span>
        </span>
        <span className="font-display mt-3 text-sm font-bold uppercase tracking-[0.12em] text-foreground">
          {title}
        </span>
        <span className="font-signal mt-1 text-[11px] text-accent">{subtitle}</span>
      </motion.div>
    </div>
  );
}

function MicIcon() {
  const stroke = "#f6f3fb";
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke={stroke} strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="22" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="22" x2="16" y2="22" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

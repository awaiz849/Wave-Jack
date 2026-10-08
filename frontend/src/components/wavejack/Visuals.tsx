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

const BARS = 14;
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
    <div className="flex h-24 items-end justify-center gap-1.5" aria-hidden="true">
      {heights.map((h, i) => (
        <motion.div
          key={i}
          className="w-1.5"
          style={{ background: "var(--accent)" }}
          animate={{ height: `${h * 100}%` }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

interface OrbProps {
  state: "idle" | "listening" | "processing";
  countdown: number;
  /** Length of a recording in seconds; the ring fills over this time. */
  total?: number;
}

/**
 * Thin hairline ring instead of a glowing gradient orb — same interaction
 * (click to record, arc fills as the countdown runs), none of the blur/glow.
 */
export function MicOrb({ state, countdown, total = 10 }: OrbProps) {
  const isListening = state === "listening";
  const isProcessing = state === "processing";
  // Percent of the ring to draw. The circle uses pathLength=100, so this holds
  // at any rendered size (the old 283 assumed a 100-unit viewBox the SVG never had,
  // so the ring stopped a third of the way round).
  const progress = isListening ? ((total - countdown) / total) * 100 : 0;

  return (
    <div
      className="relative flex h-[280px] w-[280px] items-center justify-center"
      aria-hidden="true"
    >
      {/* Soft colored glow — the one deliberate exception to "no glow" in
         this system, reserved for the single interactive focal point so it
         doesn't read as a black hole on a black background. */}
      <div
        className="absolute h-[85%] w-[85%] rounded-full"
        style={{
          background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
          opacity: isListening ? 0.35 : 0.18,
          filter: "blur(30px)",
          transition: "opacity 0.4s ease",
        }}
      />

      <div
        className="absolute inset-0 rounded-full border"
        style={{ borderColor: "var(--border)" }}
      />

      <svg className="absolute inset-0 h-full w-full -rotate-90">
        <circle
          cx="50%"
          cy="50%"
          r="49%"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${progress} 100`}
          style={{ transition: "stroke-dasharray 0.3s linear" }}
        />
      </svg>

      <motion.div
        className="relative flex h-[54%] w-[54%] items-center justify-center rounded-full border-2"
        style={{
          borderColor: "var(--accent)",
          background: isListening
            ? "var(--accent)"
            : "radial-gradient(circle at 35% 30%, oklch(0.6 0.21 264 / 0.22), oklch(0.6 0.21 264 / 0.06) 70%)",
        }}
        animate={isProcessing ? { rotate: 360 } : { scale: [1, 1.03, 1] }}
        transition={
          isProcessing
            ? { duration: 2, repeat: Infinity, ease: "linear" }
            : { duration: 2.5, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <MicIcon lit={isListening} />
      </motion.div>
    </div>
  );
}

function MicIcon({ lit }: { lit: boolean }) {
  const stroke = lit ? "var(--background)" : "var(--accent)";
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
      <rect x="9" y="2" width="6" height="12" rx="3" stroke={stroke} strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="22" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <line x1="8" y1="22" x2="16" y2="22" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

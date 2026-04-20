import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Particle = { x: number; y: number; size: number; delay: number; duration: number };

export function ParticleField() {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const arr: Particle[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      delay: Math.random() * 4,
      duration: Math.random() * 4 + 3,
    }));
    setParticles(arr);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            boxShadow: `0 0 ${p.size * 4}px rgba(180, 150, 255, 0.8)`,
          }}
          animate={{
            opacity: [0.3, 1, 0.3],
            scale: [1, 1.5, 1],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export function WaveRibbons() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 1920 1080">
        <defs>
          <linearGradient id="purpleWave" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="oklch(0.62 0.22 295)" stopOpacity="0" />
            <stop offset="50%" stopColor="oklch(0.7 0.25 300)" stopOpacity="0.7" />
            <stop offset="100%" stopColor="oklch(0.62 0.22 295)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cyanWave" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="oklch(0.78 0.16 200)" stopOpacity="0" />
            <stop offset="50%" stopColor="oklch(0.85 0.18 195)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="oklch(0.78 0.16 200)" stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <motion.path
          d="M -100 400 Q 480 200 960 450 T 2020 380"
          stroke="url(#purpleWave)"
          strokeWidth="3"
          fill="none"
          filter="url(#glow)"
          animate={{
            d: [
              "M -100 400 Q 480 200 960 450 T 2020 380",
              "M -100 420 Q 480 280 960 380 T 2020 460",
              "M -100 400 Q 480 200 960 450 T 2020 380",
            ],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M -100 700 Q 480 880 960 650 T 2020 720"
          stroke="url(#cyanWave)"
          strokeWidth="3"
          fill="none"
          filter="url(#glow)"
          animate={{
            d: [
              "M -100 700 Q 480 880 960 650 T 2020 720",
              "M -100 680 Q 480 800 960 720 T 2020 660",
              "M -100 700 Q 480 880 960 650 T 2020 720",
            ],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
    </div>
  );
}

export function LiveWaveform({ active }: { active: boolean }) {
  const bars = 12;
  const barsRef = useRef<number[]>(Array.from({ length: bars }, () => 0.3));
  const [, force] = useState(0);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      barsRef.current = barsRef.current.map(() =>
        active ? Math.random() * 0.85 + 0.15 : 0.15 + Math.random() * 0.15
      );
      force((n) => n + 1);
      raf = window.setTimeout(() => requestAnimationFrame(tick), 80) as unknown as number;
    };
    tick();
    return () => clearTimeout(raf);
  }, [active]);

  return (
    <div className="flex h-32 items-end justify-center gap-1.5">
      {barsRef.current.map((h, i) => (
        <motion.div
          key={i}
          className="w-3 rounded-t-full"
          style={{
            background: `linear-gradient(to top, oklch(0.62 0.22 295), oklch(0.78 0.16 200))`,
            boxShadow: "0 0 10px oklch(0.7 0.22 260 / 0.6)",
          }}
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
}

export function MicOrb({ state, countdown }: OrbProps) {
  const isListening = state === "listening";
  const isProcessing = state === "processing";
  const progress = isListening ? ((10 - countdown) / 10) * 283 : 0;

  return (
    <div className="relative flex h-[340px] w-[340px] items-center justify-center">
      {/* Outer rings */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${100 - i * 18}%`,
            height: `${100 - i * 18}%`,
            border: `1.5px solid ${
              i === 0 ? "oklch(1 0 0 / 0.15)" : i === 1 ? "oklch(0.78 0.16 200 / 0.5)" : "oklch(0.62 0.22 295 / 0.7)"
            }`,
            boxShadow:
              i === 1
                ? "0 0 40px oklch(0.78 0.16 200 / 0.4)"
                : i === 2
                ? "0 0 50px oklch(0.62 0.22 295 / 0.5)"
                : "none",
          }}
          animate={{
            scale: [1, 1.05, 1],
            opacity: [0.6, 1, 0.6],
          }}
          transition={{
            duration: 3 + i * 0.5,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.3,
          }}
        />
      ))}

      {/* Progress arc */}
      {isListening && (
        <svg className="absolute inset-0 h-full w-full -rotate-90">
          <circle
            cx="50%"
            cy="50%"
            r="45%"
            fill="none"
            stroke="oklch(0.85 0.18 195)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${progress} 283`}
            style={{ filter: "drop-shadow(0 0 8px oklch(0.85 0.18 195))" }}
          />
        </svg>
      )}

      {/* Inner orb */}
      <motion.div
        className="relative flex h-[58%] w-[58%] items-center justify-center rounded-full"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, oklch(0.35 0.15 290), oklch(0.12 0.06 280) 70%)",
          boxShadow:
            "inset 0 0 40px oklch(0 0 0 / 0.6), 0 0 60px oklch(0.62 0.22 295 / 0.5)",
        }}
        animate={
          isProcessing
            ? { rotate: 360 }
            : { scale: [1, 1.04, 1] }
        }
        transition={
          isProcessing
            ? { duration: 2, repeat: Infinity, ease: "linear" }
            : { duration: 3, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <MicIcon />
      </motion.div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="chromeMic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8f8ff" />
          <stop offset="40%" stopColor="#c0c0d0" />
          <stop offset="70%" stopColor="#6a6a85" />
          <stop offset="100%" stopColor="#2a2a40" />
        </linearGradient>
        <linearGradient id="chromeStand" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5a5a75" />
          <stop offset="50%" stopColor="#e0e0ee" />
          <stop offset="100%" stopColor="#3a3a55" />
        </linearGradient>
      </defs>
      <rect x="22" y="8" width="20" height="32" rx="10" fill="url(#chromeMic)" stroke="#1a1a2e" strokeWidth="0.5" />
      <rect x="25" y="13" width="14" height="2" rx="1" fill="#1a1a2e" opacity="0.4" />
      <rect x="25" y="18" width="14" height="2" rx="1" fill="#1a1a2e" opacity="0.4" />
      <rect x="25" y="23" width="14" height="2" rx="1" fill="#1a1a2e" opacity="0.4" />
      <path d="M16 36 Q16 48 32 48 Q48 48 48 36" stroke="url(#chromeStand)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <line x1="32" y1="48" x2="32" y2="56" stroke="url(#chromeStand)" strokeWidth="3" strokeLinecap="round" />
      <rect x="24" y="55" width="16" height="3" rx="1.5" fill="url(#chromeStand)" />
    </svg>
  );
}

import { motion, AnimatePresence } from "framer-motion";
import { Play } from "lucide-react";

export type Track = {
  id: string;
  title: string;
  artist: string;
  art: string;
  highlighted?: boolean;
};

const ART_GRADIENTS = [
  "linear-gradient(135deg, #7c3aed, #ec4899)",
  "linear-gradient(135deg, #06b6d4, #3b82f6)",
  "linear-gradient(135deg, #f59e0b, #ef4444)",
  "linear-gradient(135deg, #10b981, #06b6d4)",
  "linear-gradient(135deg, #8b5cf6, #06b6d4)",
];

export function artFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ART_GRADIENTS[h % ART_GRADIENTS.length];
}

export function RecentSearches({ tracks }: { tracks: Track[] }) {
  return (
    <div className="glass w-[340px] rounded-2xl p-5">
      <h3 className="mb-4 text-sm font-bold tracking-wide text-white">Recent Searches</h3>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {tracks.slice(0, 5).map((t, i) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/5"
              style={
                i === 0
                  ? {
                      background:
                        "linear-gradient(90deg, oklch(0.55 0.24 295 / 0.5), oklch(0.45 0.2 260 / 0.3))",
                      boxShadow: "0 0 20px oklch(0.62 0.22 295 / 0.3)",
                    }
                  : undefined
              }
            >
              <div
                className="h-10 w-10 shrink-0 rounded-lg"
                style={{ background: t.art }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">{t.title}</div>
                <div className="truncate text-xs text-white/50">{t.artist}</div>
              </div>
              <button className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
                <Play size={14} fill="currentColor" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {tracks.length === 0 && (
          <div className="py-8 text-center text-xs text-white/40">No identifications yet</div>
        )}
      </div>
    </div>
  );
}

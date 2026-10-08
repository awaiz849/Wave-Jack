import { motion, AnimatePresence } from "framer-motion";

export type Track = {
  id: string;
  title: string;
  artist: string;
  art: string;
  highlighted?: boolean;
};

// Placeholder album-art tiles: dark violet/magenta/amber tints from the Aurora palette.
const ART_TONES = [
  "linear-gradient(135deg, #3b1d5e, #1b1626)",
  "linear-gradient(135deg, #4a1a3d, #1b1626)",
  "linear-gradient(135deg, #4a3214, #1b1626)",
  "linear-gradient(135deg, #2c1f55, #1b1626)",
  "linear-gradient(135deg, #3d1a4f, #1b1626)",
];

export function artFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ART_TONES[h % ART_TONES.length];
}

export function RecentSearches({ tracks }: { tracks: Track[] }) {
  return (
    <section
      aria-labelledby="recent-searches"
      className="panel panel-edge w-full rounded-[var(--radius)] p-5"
    >
      <h2
        id="recent-searches"
        className="font-display mb-4 text-base font-semibold text-foreground"
      >
        Recent searches
      </h2>
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {tracks.slice(0, 5).map((t, i) => (
            <motion.li
              key={t.id}
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/[0.04] ${i === 0 ? "bg-white/[0.03]" : ""}`}
            >
              <div
                aria-hidden="true"
                className="h-10 w-10 shrink-0 rounded-lg border border-white/[0.06]"
                style={{ background: t.art }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{t.title}</div>
                <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {tracks.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No identifications yet</p>
      )}
    </section>
  );
}

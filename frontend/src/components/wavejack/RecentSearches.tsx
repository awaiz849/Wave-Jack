import { motion, AnimatePresence } from "framer-motion";

export type Track = {
  id: string;
  title: string;
  artist: string;
  art: string;
  highlighted?: boolean;
};

// Flat, muted single-tone swatches instead of colorful gradients — album
// art placeholders stay quiet so they don't compete with the accent color.
const ART_TONES = ["#2a2a2a", "#242424", "#2e2e2e", "#262626", "#2c2c2c"];

export function artFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return ART_TONES[h % ART_TONES.length];
}

export function RecentSearches({ tracks }: { tracks: Track[] }) {
  return (
    <section aria-labelledby="recent-searches" className="panel w-full rounded-md p-5 lg:w-[340px]">
      <h2
        id="recent-searches"
        className="font-signal mb-4 text-xs font-normal text-muted-foreground"
      >
        recent searches
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
              className="flex items-center gap-3 rounded-sm p-2 transition-colors hover:bg-white/[0.04]"
              style={i === 0 ? { borderLeft: "2px solid var(--accent)" } : undefined}
            >
              <div
                aria-hidden="true"
                className="h-10 w-10 shrink-0 rounded-sm"
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
        <p className="py-8 text-center text-xs text-muted-foreground">No identifications yet</p>
      )}
    </section>
  );
}

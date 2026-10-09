import { useEffect, useState } from "react";
import { API_URL } from "@/lib/config";

export type LibraryStats =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; songs: number; fingerprints: number };

/** Reads the public GET /stats counts once on mount. */
export function useLibraryStats(): LibraryStats {
  const [stats, setStats] = useState<LibraryStats>({ status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_URL}/stats`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { songs: number; fingerprints: number }) =>
        setStats({ status: "ok", songs: d.songs, fingerprints: d.fingerprints }),
      )
      .catch((e) => {
        if (!ctrl.signal.aborted) setStats({ status: "error" });
        if (e?.name !== "AbortError") console.warn("[WaveJack] stats unavailable:", e);
      });
    return () => ctrl.abort();
  }, []);
  return stats;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function StatsRow({ stats }: { stats: LibraryStats }) {
  const value = (n: number | undefined) =>
    stats.status === "ok" && n !== undefined ? fmt(n) : stats.status === "loading" ? "…" : "—";
  const items = [
    { label: "Songs in library", value: value(stats.status === "ok" ? stats.songs : undefined) },
    {
      label: "Fingerprints stored",
      value: value(stats.status === "ok" ? stats.fingerprints : undefined),
    },
  ];
  return (
    <dl className="hairline-t mt-8 flex flex-wrap gap-x-10 gap-y-4 pt-6">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className="font-display mt-1 text-2xl font-bold tabular-nums text-foreground">
            {it.value}
          </dd>
        </div>
      ))}
      {stats.status === "error" && (
        <p className="w-full text-xs text-muted-foreground">
          Library counts are unavailable right now.
        </p>
      )}
    </dl>
  );
}

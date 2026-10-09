import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/wavejack/PageShell";
import { API_URL } from "@/lib/config";
import { Music, Compass } from "lucide-react";

export const Route = createFileRoute("/discover")({
  head: () => ({
    meta: [
      { title: "Discover — WaveJack" },
      { name: "description", content: "Browse songs in the WaveJack library." },
    ],
  }),
  component: DiscoverPage,
});

type Song = { id?: string | number; title: string; artist: string };

function DiscoverPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = () => {
    setLoading(true);
    setOffline(false);
    fetch(`${API_URL}/songs`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setSongs(Array.isArray(data) ? data : data?.songs || []))
      .catch(() => setOffline(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <PageShell>
      <span className="inline-flex items-center gap-2 rounded-full border border-[rgb(192_132_252/0.25)] bg-[rgb(168_85_247/0.1)] px-3 py-1 text-xs text-accent-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent-2)]" />
        Library
      </span>
      <h1 className="font-display mt-4 mb-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        <span className="text-gradient">Discover</span>
      </h1>
      <p className="hairline-b mb-8 pb-8 text-muted-foreground">
        Everything WaveJack can currently recognize.
      </p>

      {loading ? (
        <p role="status" className="font-signal text-sm text-muted-foreground">
          loading library…
        </p>
      ) : offline ? (
        <div role="alert" className="panel panel-edge rounded-[var(--radius)] p-10 text-center">
          <Compass size={20} aria-hidden="true" className="mx-auto mb-3 text-accent-2" />
          <div className="text-foreground">Can't reach the WaveJack API right now.</div>
          <div className="font-signal mt-1 break-all text-xs text-muted-foreground">
            Check that the backend is running at {API_URL}.
          </div>
          <button type="button" onClick={load} className="btn-secondary mt-5 px-5 py-2 text-sm">
            Try again
          </button>
        </div>
      ) : songs.length === 0 ? (
        <div className="panel panel-edge rounded-[var(--radius)] p-10 text-center">
          <Music size={20} aria-hidden="true" className="mx-auto mb-3 text-accent-2" />
          <div className="text-foreground">No songs in the library yet.</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Add one from the admin panel to start building it out.
          </div>
        </div>
      ) : (
        <ul
          aria-label={`${songs.length} songs in the library`}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
        >
          {songs.map((s, i) => (
            <li
              key={s.id ?? i}
              className="panel group min-w-0 rounded-[var(--radius)] p-4 transition-colors hover:border-[var(--border-strong)] sm:p-5"
            >
              <div
                aria-hidden="true"
                className="bg-gradient-icon mb-6 flex h-10 w-10 items-center justify-center rounded-xl p-px"
              >
                <span className="flex h-full w-full items-center justify-center rounded-[11px] bg-[var(--card)]">
                  <Music size={16} className="text-accent-2" />
                </span>
              </div>
              <div className="truncate font-medium text-foreground">{s.title}</div>
              <div className="truncate text-sm text-muted-foreground">{s.artist}</div>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

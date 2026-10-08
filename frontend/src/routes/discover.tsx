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
      <h1 className="font-display mb-2 text-4xl font-semibold text-foreground">Discover</h1>
      <p className="hairline-b mb-8 pb-8 text-muted-foreground">
        Everything WaveJack can currently recognize.
      </p>

      {loading ? (
        <p role="status" className="font-signal text-sm text-muted-foreground">
          loading library…
        </p>
      ) : offline ? (
        <div role="alert" className="panel rounded-md p-10 text-center">
          <Compass size={20} aria-hidden="true" className="mx-auto mb-3 text-muted-foreground" />
          <div className="text-foreground">Can't reach the WaveJack API right now.</div>
          <div className="font-signal mt-1 break-all text-xs text-muted-foreground">
            Check that the backend is running at {API_URL}.
          </div>
          <button
            type="button"
            onClick={load}
            className="mt-5 rounded-full border border-border px-5 py-2 text-sm text-foreground transition-colors hover:bg-white/[0.04]"
          >
            Try again
          </button>
        </div>
      ) : songs.length === 0 ? (
        <div className="panel rounded-md p-10 text-center">
          <Music size={20} aria-hidden="true" className="mx-auto mb-3 text-muted-foreground" />
          <div className="text-foreground">No songs in the library yet.</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Add one from the admin panel to start building it out.
          </div>
        </div>
      ) : (
        <ul
          aria-label={`${songs.length} songs in the library`}
          className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-4"
          style={{ background: "var(--border)" }}
        >
          {songs.map((s, i) => (
            <li
              key={s.id ?? i}
              className="group min-w-0 bg-background p-5 transition-colors hover:bg-white/[0.03]"
            >
              <div
                aria-hidden="true"
                className="mb-8 flex h-10 w-10 items-center justify-center rounded-full border border-border"
              >
                <Music size={16} className="text-signal" />
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

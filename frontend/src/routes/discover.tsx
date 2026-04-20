import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/wavejack/PageShell";
import { Music } from "lucide-react";

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

const PLACEHOLDERS: Song[] = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  title: "Song Title",
  artist: "Artist",
}));

function DiscoverPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:8000/songs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.songs || [];
        setSongs(list.length ? list : PLACEHOLDERS);
      })
      .catch(() => setSongs(PLACEHOLDERS))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageShell>
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-4xl font-bold text-white">Discover</h1>
        <p className="mb-8 text-white/50">Songs in the WaveJack library.</p>
        {loading ? (
          <div className="text-white/40">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {songs.map((s, i) => (
              <div
                key={s.id ?? i}
                className="group relative overflow-hidden rounded-2xl p-5 transition-transform hover:scale-[1.03]"
                style={{
                  background: "var(--gradient-purple)",
                  boxShadow: "var(--shadow-glow-purple)",
                }}
              >
                <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  <Music size={22} className="text-white" />
                </div>
                <div className="truncate text-base font-bold text-white">{s.title}</div>
                <div className="truncate text-sm text-white/70">{s.artist}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

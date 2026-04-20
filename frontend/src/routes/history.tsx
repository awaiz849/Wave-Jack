import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/wavejack/PageShell";
import { getHistory, getHistoryDB, getUser, type HistoryItem } from "@/components/wavejack/Auth";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Your History — WaveJack" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = getUser();
    if (user) {
      // Try Supabase first, fallback to localStorage
      getHistoryDB()
        .then((dbItems) => {
          if (dbItems.length > 0) {
            setItems(dbItems);
          } else {
            setItems(getHistory());
          }
        })
        .catch(() => setItems(getHistory()))
        .finally(() => setLoading(false));
    } else {
      setItems(getHistory());
      setLoading(false);
    }
  }, []);

  return (
    <PageShell>
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-4xl font-bold text-white">Your History</h1>
        <p className="mb-8 text-white/50">All the songs you've identified.</p>

        {loading ? (
          <div className="glass rounded-2xl p-12 text-center text-white/40">Loading…</div>
        ) : items.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center text-white/60">
            No identifies yet — tap the mic to start
          </div>
        ) : (
          <div className="glass overflow-hidden rounded-2xl">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-white/50">
                <tr>
                  <th className="px-5 py-4">Title</th>
                  <th className="px-5 py-4">Artist</th>
                  <th className="px-5 py-4">Confidence</th>
                  <th className="px-5 py-4">Identified</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="px-5 py-4 font-semibold text-white">{it.title}</td>
                    <td className="px-5 py-4 text-white/70">{it.artist}</td>
                    <td className="px-5 py-4 text-cyan">
                      {it.confidence > 0 ? `${(it.confidence * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-5 py-4 text-white/50">{new Date(it.at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  );
}

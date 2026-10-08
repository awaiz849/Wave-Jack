import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/wavejack/PageShell";
import { getHistory, getHistoryDB, useAuth, type HistoryItem } from "@/components/wavejack/Auth";
import { AudioWaveform } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Your history — WaveJack" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Where the rows came from, so the copy above the table tells the truth.
  const [source, setSource] = useState<"account" | "device">("device");
  const [syncFailed, setSyncFailed] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const signedIn = !!user;

  useEffect(() => {
    if (authLoading) return;
    setSyncFailed(false);
    if (user) {
      setLoading(true);
      getHistoryDB()
        .then((dbItems) => {
          setSource(dbItems.length > 0 ? "account" : "device");
          setItems(dbItems.length > 0 ? dbItems : getHistory());
        })
        .catch((e) => {
          console.error("[WaveJack]", e);
          setSyncFailed(true);
          setSource("device");
          setItems(getHistory());
        })
        .finally(() => setLoading(false));
    } else {
      setSource("device");
      setItems(getHistory());
      setLoading(false);
    }
  }, [authLoading, user]);

  return (
    <PageShell>
      <div className="mx-auto max-w-4xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-[rgb(192_132_252/0.25)] bg-[rgb(168_85_247/0.1)] px-3 py-1 text-xs text-accent-2">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent-2)]" />
          Identifications
        </span>
        <h1 className="font-display mt-4 mb-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Your <span className="text-gradient">history</span>
        </h1>
        <p className="hairline-b mb-8 pb-8 text-muted-foreground">
          {source === "account"
            ? "Every song you've identified, synced to your account."
            : signedIn
              ? "Songs identified on this device."
              : "Songs identified on this device. Sign in to keep them across devices."}
        </p>

        {syncFailed && (
          <p
            role="alert"
            className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            Couldn't load your synced history, so this shows what's saved on this device.
          </p>
        )}

        {loading ? (
          <p role="status" className="font-signal text-sm text-muted-foreground">
            loading history…
          </p>
        ) : items.length === 0 ? (
          <div className="panel panel-edge rounded-[var(--radius)] p-12 text-center">
            <AudioWaveform size={20} aria-hidden="true" className="mx-auto mb-4 text-accent-2" />
            <div className="text-foreground">You haven't identified anything yet.</div>
            <Link to="/" className="btn-primary mt-5 px-5 py-2.5 text-sm">
              Identify a song
            </Link>
          </div>
        ) : (
          <div className="panel panel-edge rounded-[var(--radius)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Songs you've identified, newest first</caption>
                <thead className="font-signal text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-5 pt-5 pb-3 font-normal">
                      Title
                    </th>
                    <th scope="col" className="px-5 pt-5 pb-3 font-normal">
                      Artist
                    </th>
                    <th scope="col" className="px-5 pt-5 pb-3 font-normal">
                      Identified
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="hairline-t transition-colors hover:bg-white/[0.03]">
                      <td className="px-5 py-4 font-medium text-foreground">{it.title}</td>
                      <td className="px-5 py-4 text-muted-foreground">{it.artist}</td>
                      <td className="font-signal whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">
                        {new Date(it.at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

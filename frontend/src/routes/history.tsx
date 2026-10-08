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
        <h1 className="font-display mb-2 text-4xl font-semibold text-foreground">Your history</h1>
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
            className="mb-6 rounded-sm border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            Couldn't load your synced history, so this shows what's saved on this device.
          </p>
        )}

        {loading ? (
          <p role="status" className="font-signal text-sm text-muted-foreground">
            loading history…
          </p>
        ) : items.length === 0 ? (
          <div className="panel rounded-md p-12 text-center">
            <AudioWaveform
              size={20}
              aria-hidden="true"
              className="mx-auto mb-4 text-muted-foreground"
            />
            <div className="text-foreground">You haven't identified anything yet.</div>
            <Link
              to="/"
              className="mt-4 inline-block rounded-full bg-foreground px-5 py-2 text-sm font-semibold text-background hover:opacity-90"
            >
              Identify a song
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Songs you've identified, newest first</caption>
            <thead className="hairline-b font-signal text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-3 pr-4 font-normal">
                  Title
                </th>
                <th scope="col" className="py-3 pr-4 font-normal">
                  Artist
                </th>
                <th scope="col" className="py-3 pr-4 font-normal">
                  Identified
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="hairline-b transition-colors hover:bg-white/[0.03]">
                  <td className="py-4 pr-4 font-medium text-foreground">{it.title}</td>
                  <td className="py-4 pr-4 text-muted-foreground">{it.artist}</td>
                  <td className="font-signal py-4 text-xs text-muted-foreground">
                    {new Date(it.at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  );
}

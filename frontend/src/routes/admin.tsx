import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/wavejack/PageShell";
import { API_URL } from "@/lib/config";
import {
  useAuth,
  verifyAdmin,
  authHeaders,
  getHistory,
  type HistoryItem,
} from "@/components/wavejack/Auth";
import { Trash2, Upload, Music, Activity } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — WaveJack" }] }),
  component: AdminPage,
});

type Song = { id?: string | number; title: string; artist: string };

// The backend's own message (401 expired session, 403 not admin, 413 too big, 415 not audio…).
async function apiError(r: Response, fallback: string): Promise<string> {
  const body = await r.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : `${fallback} (HTTP ${r.status})`;
}

const inputClass =
  "rounded-sm border border-border bg-transparent px-4 py-3 text-foreground placeholder:text-muted-foreground transition-colors focus:border-[var(--accent)] focus:outline-none";

function AdminPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songsState, setSongsState] = useState<"loading" | "ready" | "error">("loading");
  const [fileInputKey, setFileInputKey] = useState(0); // remount to clear the chosen file
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [youtube, setYoutube] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | number | null>(null);

  const { user, loading: authLoading } = useAuth();

  // Re-verify with the backend whenever the signed-in user changes
  // (including sign-out from this or another tab).
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    verifyAdmin().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        setReady(false);
        navigate({ to: "/" });
        return;
      }
      setReady(true);
      setHistory(getHistory());
      loadSongs();
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, navigate]);

  const loadSongs = () => {
    setSongsState("loading");
    fetch(`${API_URL}/songs`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setSongs(Array.isArray(data) ? data : data?.songs || []);
        setSongsState("ready");
      })
      .catch(() => setSongsState("error"));
  };

  const deleteSong = async (song: Song) => {
    const id = song.id;
    if (id == null) return;
    if (
      !window.confirm(`Delete "${song.title}" from the library? Its fingerprints are removed too.`)
    ) {
      return;
    }
    setDeleting(id);
    try {
      const r = await fetch(`${API_URL}/songs/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!r.ok) {
        setMsg({ text: await apiError(r, "Couldn't delete that song"), ok: false });
        return;
      }
      setSongs((s) => s.filter((x) => x.id !== id));
    } catch {
      setMsg({ text: "Couldn't reach the backend to delete that song.", ok: false });
    } finally {
      setDeleting(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setMsg({ text: "Pick an audio file before adding the song.", ok: false });
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("artist", artist);
      if (youtube) fd.append("youtube_url", youtube);
      fd.append("audio", file);
      const r = await fetch(`${API_URL}/add`, {
        method: "POST",
        body: fd,
        headers: await authHeaders(),
      });
      if (!r.ok) {
        setMsg({ text: await apiError(r, "Couldn't add the song"), ok: false });
        return;
      }
      setMsg({ text: `Added "${title}" to the library.`, ok: true });
      setTitle("");
      setArtist("");
      setYoutube("");
      setFile(null);
      setFileInputKey((k) => k + 1);
      loadSongs();
    } catch {
      setMsg({ text: "Couldn't add the song. Check that the backend is running.", ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <PageShell>
        <p role="status" className="font-signal text-sm text-muted-foreground">
          checking admin access…
        </p>
      </PageShell>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const identifiesToday = history.filter((h) => h.at >= today.getTime()).length;

  return (
    <PageShell>
      <div className="space-y-10">
        <div>
          <h1 className="font-display text-4xl font-semibold text-foreground">Admin</h1>
          <p className="mt-2 text-muted-foreground">
            Manage the song library and review recent activity.
          </p>
        </div>

        <div className="hairline-t hairline-b grid grid-cols-1 divide-y divide-border py-6 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <StatCard
            icon={<Music size={15} aria-hidden="true" />}
            label="Songs in library"
            value={songsState === "ready" ? songs.length : "—"}
          />
          <StatCard
            icon={<Activity size={15} aria-hidden="true" />}
            label="Identified today (this device)"
            value={identifiesToday}
          />
        </div>

        <section>
          <h2 className="font-display mb-4 text-xl font-semibold text-foreground">Add a song</h2>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="sr-only" htmlFor="song-title">
              Title
            </label>
            <input
              id="song-title"
              required
              maxLength={200}
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
            <label className="sr-only" htmlFor="song-artist">
              Artist
            </label>
            <input
              id="song-artist"
              required
              maxLength={200}
              placeholder="Artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className={inputClass}
            />
            <label className="sr-only" htmlFor="song-youtube">
              YouTube URL (optional)
            </label>
            <input
              id="song-youtube"
              type="url"
              placeholder="YouTube URL (optional)"
              value={youtube}
              onChange={(e) => setYoutube(e.target.value)}
              className={`${inputClass} md:col-span-2`}
            />
            <label className="sr-only" htmlFor="song-file">
              Audio file
            </label>
            <input
              key={fileInputKey}
              id="song-file"
              type="file"
              accept="audio/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="min-w-0 rounded-sm border border-border bg-transparent px-4 py-3 text-sm text-muted-foreground file:mr-3 file:rounded-sm file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-foreground md:col-span-2"
            />
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center justify-center gap-2 rounded-sm bg-foreground py-3 font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50 md:col-span-2"
            >
              <Upload size={16} aria-hidden="true" /> {submitting ? "Adding…" : "Add song"}
            </button>
            {msg && (
              <div
                role={msg.ok ? "status" : "alert"}
                className={`text-sm md:col-span-2 ${msg.ok ? "text-signal" : "text-destructive"}`}
              >
                {msg.text}
              </div>
            )}
          </form>
          <p className="font-signal mt-3 text-xs text-muted-foreground">
            Fingerprinting runs on upload — larger files take a few seconds.
          </p>
        </section>

        <section>
          <h2 className="font-display hairline-b mb-4 pb-4 text-xl font-semibold text-foreground">
            Library
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="hairline-b font-signal text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-3 pr-4 font-normal">
                    Title
                  </th>
                  <th scope="col" className="py-3 pr-4 font-normal">
                    Artist
                  </th>
                  <th className="py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {songsState === "loading" && (
                  <tr>
                    <td
                      colSpan={3}
                      role="status"
                      className="font-signal py-10 text-center text-sm text-muted-foreground"
                    >
                      loading library…
                    </td>
                  </tr>
                )}
                {songsState === "error" && (
                  <tr>
                    <td colSpan={3} role="alert" className="py-10 text-center text-destructive">
                      Couldn't load the library.{" "}
                      <button
                        type="button"
                        onClick={loadSongs}
                        className="underline underline-offset-2"
                      >
                        Try again
                      </button>
                    </td>
                  </tr>
                )}
                {songsState === "ready" && songs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-muted-foreground">
                      Nothing here yet — add your first song above.
                    </td>
                  </tr>
                )}
                {songsState === "ready" &&
                  songs.map((s, i) => (
                    <tr
                      key={s.id ?? i}
                      className="hairline-b transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="py-3 font-medium text-foreground">{s.title}</td>
                      <td className="py-3 text-muted-foreground">{s.artist}</td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() => deleteSong(s)}
                          disabled={deleting === s.id}
                          aria-label={`Delete ${s.title}`}
                          className="inline-flex items-center gap-1 rounded-sm border border-destructive/30 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                        >
                          <Trash2 size={12} aria-hidden="true" />{" "}
                          {deleting === s.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-display hairline-b mb-4 pb-4 text-xl font-semibold text-foreground">
            Recent identifications{" "}
            <span className="text-sm font-normal text-muted-foreground">(this device)</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="hairline-b font-signal text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-3 pr-4 font-normal">
                    Title
                  </th>
                  <th scope="col" className="py-3 pr-4 font-normal">
                    Artist
                  </th>
                  <th scope="col" className="py-3 pr-4 font-normal">
                    Confidence
                  </th>
                  <th scope="col" className="py-3 pr-4 font-normal">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      No identifications recorded yet.
                    </td>
                  </tr>
                )}
                {history.slice(0, 20).map((h, i) => (
                  <tr key={i} className="hairline-b transition-colors hover:bg-white/[0.03]">
                    <td className="py-3 font-medium text-foreground">{h.title}</td>
                    <td className="py-3 text-muted-foreground">{h.artist}</td>
                    <td className="font-signal py-3 text-signal">
                      {(h.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="font-signal py-3 text-xs text-muted-foreground">
                      {new Date(h.at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="px-6 py-2 first:pl-0 sm:px-8">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="font-signal mt-2 text-4xl font-medium text-signal">{value}</div>
    </div>
  );
}

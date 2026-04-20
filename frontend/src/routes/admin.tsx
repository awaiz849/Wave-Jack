import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/wavejack/PageShell";
import { getUser, isAdmin, getHistory, type HistoryItem } from "@/components/wavejack/Auth";
import { Trash2, Upload } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — WaveJack" }] }),
  component: AdminPage,
});

type Song = { id?: string | number; title: string; artist: string; fingerprints?: number };

function AdminPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [youtube, setYoutube] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!isAdmin(u)) {
      navigate({ to: "/" });
      return;
    }
    setReady(true);
    setHistory(getHistory());
    loadSongs();
  }, [navigate]);

  const loadSongs = () => {
    fetch("http://localhost:8000/songs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setSongs(Array.isArray(data) ? data : data?.songs || []))
      .catch(() => setSongs([]));
  };

  const deleteSong = async (id: string | number | undefined) => {
    if (id == null) return;
    try {
      await fetch(`http://localhost:8000/songs/${id}`, { method: "DELETE" });
    } catch {
      /* noop */
    }
    setSongs((s) => s.filter((x) => x.id !== id));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("artist", artist);
      if (youtube) fd.append("youtube_url", youtube);
      if (file) fd.append("audio", file);
      const r = await fetch("http://localhost:8000/add", { method: "POST", body: fd });
      if (!r.ok) throw new Error();
      setMsg("Song added successfully");
      setTitle(""); setArtist(""); setYoutube(""); setFile(null);
      loadSongs();
    } catch {
      setMsg("Failed to add song (API offline?)");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const identifiesToday = history.filter((h) => h.at >= today.getTime()).length;

  return (
    <PageShell>
      <div className="mx-auto max-w-6xl space-y-8">
        <h1 className="text-4xl font-bold text-white">Admin Panel</h1>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total Songs" value={songs.length} />
          <StatCard label="Identifies Today" value={identifiesToday} />
          <StatCard label="Total Users" value={1} />
        </div>

        <section className="glass rounded-2xl p-6">
          <h2 className="mb-4 text-xl font-bold text-white">Add Song</h2>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input required placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 focus:border-purple focus:outline-none" />
            <input required placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 focus:border-purple focus:outline-none" />
            <input placeholder="YouTube URL" value={youtube} onChange={(e) => setYoutube(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 focus:border-purple focus:outline-none md:col-span-2" />
            <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white md:col-span-2" />
            <button type="submit" disabled={submitting}
              className="flex items-center justify-center gap-2 rounded-lg py-3 font-semibold text-white disabled:opacity-50 md:col-span-2"
              style={{ background: "var(--gradient-purple)", boxShadow: "var(--shadow-glow-purple)" }}>
              <Upload size={16} /> {submitting ? "Uploading…" : "Add Song"}
            </button>
            {msg && <div className="text-sm text-white/70 md:col-span-2">{msg}</div>}
          </form>
        </section>

        <section className="glass overflow-hidden rounded-2xl">
          <h2 className="px-6 pt-6 text-xl font-bold text-white">Songs</h2>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-white/50">
              <tr>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Artist</th>
                <th className="px-6 py-3">Fingerprints</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {songs.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-white/40">No songs available</td></tr>
              )}
              {songs.map((s, i) => (
                <tr key={s.id ?? i} className="border-b border-white/5">
                  <td className="px-6 py-3 font-semibold text-white">{s.title}</td>
                  <td className="px-6 py-3 text-white/70">{s.artist}</td>
                  <td className="px-6 py-3 text-cyan">{s.fingerprints ?? "—"}</td>
                  <td className="px-6 py-3 text-right">
                    <button onClick={() => deleteSong(s.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
                      <Trash2 size={12} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="glass overflow-hidden rounded-2xl">
          <h2 className="px-6 pt-6 text-xl font-bold text-white">Recent Identifies</h2>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-white/50">
              <tr>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Artist</th>
                <th className="px-6 py-3">Confidence</th>
                <th className="px-6 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-white/40">No identifies yet</td></tr>
              )}
              {history.slice(0, 20).map((h, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-6 py-3 font-semibold text-white">{h.title}</td>
                  <td className="px-6 py-3 text-white/70">{h.artist}</td>
                  <td className="px-6 py-3 text-cyan">{(h.confidence * 100).toFixed(0)}%</td>
                  <td className="px-6 py-3 text-white/50">{new Date(h.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-6">
      <div className="text-xs uppercase tracking-wider text-white/50">{label}</div>
      <div className="mt-2 text-4xl font-bold text-gradient-wave">{value}</div>
    </div>
  );
}

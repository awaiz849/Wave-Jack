import { useEffect, useRef, useState } from "react";
import { EMPTY_TIMING, type MicDebugTiming } from "@/lib/mic-debug-timing";

/**
 * TEMPORARY dev-only microphone diagnostics. Rendered only when
 * import.meta.env.DEV is true (see routes/index.tsx), so it never ships in a
 * production build. Remove once real-mic recognition works.
 *
 * Shows what the browser actually gives us: the device, whether the track is
 * muted, which processing settings were applied, a live input level, how many
 * bytes went to the backend, and a player for exactly those bytes.
 */
export type MicDebugSent = { chunks: number; bytes: number; mimeType: string };

const span = (from: number | null, to: number | null) =>
  from === null || to === null ? "—" : `${Math.round(to - from).toLocaleString()} ms`;

type TrackInfo = {
  label: string;
  muted: boolean;
  readyState: string;
  settings: MediaTrackSettings;
};

export function MicDebugPanel({
  stream,
  sent,
  recordingUrl,
  timing = EMPTY_TIMING,
}: {
  stream: MediaStream | null;
  sent: MicDebugSent;
  recordingUrl: string | null;
  timing?: MicDebugTiming;
}) {
  const [track, setTrack] = useState<TrackInfo | null>(null);
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [peakDb, setPeakDb] = useState<number | null>(null);
  const peakRef = useRef(-Infinity);

  // Track label / muted / applied settings, kept after the mic stops so you can read them.
  useEffect(() => {
    const t = stream?.getAudioTracks()[0];
    if (!t) return;
    const read = () =>
      setTrack({
        label: t.label || "(no label)",
        muted: t.muted,
        readyState: t.readyState,
        settings: t.getSettings(),
      });
    read();
    t.addEventListener("mute", read);
    t.addEventListener("unmute", read);
    t.addEventListener("ended", read);
    return () => {
      t.removeEventListener("mute", read);
      t.removeEventListener("unmute", read);
      t.removeEventListener("ended", read);
    };
  }, [stream]);

  // Live input level from an AnalyserNode (RMS in dBFS; 0 = full scale).
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) {
      setLevelDb(null);
      return;
    }
    peakRef.current = -Infinity;
    setPeakDb(null);
    const ctx = new AudioContext();
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser); // not connected to the speakers: no feedback
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      setLevelDb(db);
      if (db > peakRef.current) {
        peakRef.current = db;
        setPeakDb(db);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream]);

  const fmt = (db: number | null) =>
    db === null ? "—" : Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : "-∞ (digital silence)";
  // Map -60..0 dBFS onto 0..100% for the bar.
  const pct =
    levelDb === null || !Number.isFinite(levelDb)
      ? 0
      : Math.max(0, Math.min(100, ((levelDb + 60) / 60) * 100));
  const s = track?.settings;
  const flag = (v: boolean | undefined) => (v === undefined ? "n/a" : v ? "ON" : "off");

  return (
    <section
      aria-label="Microphone debug (development only)"
      className="panel mx-auto mb-6 max-w-6xl rounded-md p-5 font-signal text-xs text-muted-foreground"
    >
      <div className="mb-3 text-foreground">mic debug · dev only</div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <dt>device (track.label)</dt>
        <dd className="text-foreground">{track?.label ?? "— (not recording yet)"}</dd>
        <dt>track.muted / readyState</dt>
        <dd className="text-foreground">{track ? `${track.muted} / ${track.readyState}` : "—"}</dd>
        <dt>applied: echoCancellation / noiseSuppression / autoGainControl</dt>
        <dd className="text-foreground">
          {s
            ? `${flag(s.echoCancellation)} / ${flag(s.noiseSuppression)} / ${flag(s.autoGainControl)}`
            : "—"}
        </dd>
        <dt>sampleRate / channelCount</dt>
        <dd className="text-foreground">
          {s ? `${s.sampleRate ?? "?"} Hz / ${s.channelCount ?? "?"}` : "—"}
        </dd>
        <dt>input level (now / peak)</dt>
        <dd className="text-foreground">
          {fmt(levelDb)} / {fmt(peakDb)}
        </dd>
        <dt>sent to backend</dt>
        <dd className="text-foreground">
          {sent.chunks} chunks · {sent.bytes.toLocaleString()} bytes · {sent.mimeType || "—"}
        </dd>
        <dt>tap → first chunk sent</dt>
        <dd className="text-foreground">{span(timing.tapAt, timing.firstChunkAt)}</dd>
        <dt>first chunk → first backend reply</dt>
        <dd className="text-foreground">{span(timing.firstChunkAt, timing.firstReplyAt)}</dd>
        <dt>first chunk → final answer</dt>
        <dd className="text-foreground">
          {span(timing.firstChunkAt, timing.finalAt)}
          {timing.outcome ? ` · ${timing.outcome}` : ""}
        </dd>
        <dt>matched on round (audio it had)</dt>
        <dd className="text-foreground">
          {timing.round !== null
            ? `round ${timing.round} · ${timing.audioChunks ?? "?"} chunks` +
              (timing.audioChunks !== null && timing.chunkMs
                ? ` (~${((timing.audioChunks * timing.chunkMs) / 1000).toFixed(1)} s of audio)`
                : "")
            : "—"}
        </dd>
      </dl>
      <div className="mt-3 h-2 w-full rounded-sm bg-white/[0.06]" aria-hidden="true">
        <div className="h-2 rounded-sm" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
      {recordingUrl && (
        <div className="mt-4">
          <div className="mb-1">play back what was sent to the backend:</div>
          <audio controls src={recordingUrl} className="w-full" />
          <a
            href={recordingUrl}
            download={`wavejack-mic-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`}
            className="mt-2 inline-block text-accent-2 underline underline-offset-2 hover:text-foreground"
          >
            download this recording (.webm)
          </a>
        </div>
      )}
    </section>
  );
}

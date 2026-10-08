import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, ExternalLink } from "lucide-react";

export type MatchResult = {
  title: string;
  artist: string;
  confidence: number;
  youtube_url?: string | null;
};

// Only ever link out to a real web address (the backend already enforces this).
const isWebUrl = (url: string | null | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path (e.g. http:// on a LAN address) */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const buttonClass =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-foreground transition-colors hover:bg-white/[0.04]";

export function ResultCard({ result }: { result: MatchResult }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const onCopy = async () => {
    const ok = await copyText(`${result.title} - ${result.artist}`);
    setCopied(ok ? "done" : "failed");
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => setCopied("idle"), 2000);
  };

  return (
    <motion.section
      aria-label="Match result"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel panel-edge glow-violet mt-4 max-w-sm rounded-[var(--radius)] p-5"
    >
      <div className="font-signal text-sm text-signal">
        matched · {Math.round(result.confidence * 100)}% confidence
      </div>
      <div className="font-display mt-2 text-2xl font-semibold text-foreground">{result.title}</div>
      <div className="text-base text-muted-foreground">{result.artist}</div>

      <div className="hairline-t mt-4 flex flex-wrap items-center gap-3 pt-4">
        {isWebUrl(result.youtube_url) && (
          <a
            href={result.youtube_url}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass}
          >
            <ExternalLink size={14} aria-hidden="true" /> Open on YouTube
          </a>
        )}
        <button type="button" onClick={onCopy} className={buttonClass}>
          {copied === "done" ? (
            <Check size={14} aria-hidden="true" className="text-signal" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          {copied === "done" ? "Copied" : "Copy"}
        </button>
        <span
          role="status"
          aria-live="polite"
          className="font-signal text-xs text-muted-foreground"
        >
          {copied === "done" ? "copied to clipboard" : copied === "failed" ? "couldn't copy" : ""}
        </span>
      </div>
    </motion.section>
  );
}

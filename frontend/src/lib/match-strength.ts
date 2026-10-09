// How sure a match is, from the real vote counts the backend returns (`votes` =
// aligned hashes for the winning song, `runner_up_votes` = best other song).
// A percentage would suggest a calibrated probability, which this isn't.

export type MatchStrength = "Strong" | "Clear" | "Borderline";

export type MatchVotes = {
  votes?: number | null;
  runner_up_votes?: number | null;
};

const hasVotes = (m: MatchVotes): m is { votes: number; runner_up_votes?: number | null } =>
  typeof m.votes === "number" && m.votes > 0;

/** Strong: >= 5x the runner-up and >= 50 votes. Clear: >= 3x. Otherwise Borderline. */
export function matchStrength(m: MatchVotes): MatchStrength | null {
  if (!hasVotes(m)) return null; // no vote data (e.g. account history) -> no label
  const runnerUp = m.runner_up_votes ?? 0;
  const lead = runnerUp > 0 ? m.votes / runnerUp : Infinity;
  if (lead >= 5 && m.votes >= 50) return "Strong";
  if (lead >= 3) return "Clear";
  return "Borderline";
}

/** "42 aligned hashes · 6x the next best song" / "… · no competing match". */
export function matchDetail(m: MatchVotes): string | null {
  if (!hasVotes(m)) return null;
  const runnerUp = m.runner_up_votes ?? 0;
  const hashes = `${m.votes} aligned ${m.votes === 1 ? "hash" : "hashes"}`;
  if (runnerUp <= 0) return `${hashes} · no competing match`;
  const lead = m.votes / runnerUp;
  const leadText = lead >= 10 ? Math.round(lead).toString() : lead.toFixed(1).replace(/\.0$/, "");
  return `${hashes} · ${leadText}x the next best song`;
}

/** Text colour per label (all pass WCAG AA on --card). */
export const STRENGTH_TONE: Record<MatchStrength, string> = {
  Strong: "text-success",
  Clear: "text-accent-2",
  Borderline: "text-accent-3",
};

/** Pill styling per label: tinted fill + hairline in the label's accent (text stays >= 7:1). */
export const STRENGTH_BADGE: Record<MatchStrength, string> = {
  Strong: "border-[rgb(52_211_153/0.3)] bg-[rgb(52_211_153/0.1)] text-success",
  Clear: "border-[rgb(192_132_252/0.3)] bg-[rgb(168_85_247/0.12)] text-accent-2",
  Borderline: "border-[rgb(251_191_36/0.3)] bg-[rgb(251_191_36/0.1)] text-accent-3",
};

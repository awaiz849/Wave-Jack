import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";

export const ADMIN_EMAIL = "mohd.awaiz388@gmail.com";

export type AuthUser = { email: string; name: string };

export type HistoryItem = {
  title: string;
  artist: string;
  confidence: number;
  hashes_matched: number;
  at: number;
};

// ── LOCAL HISTORY ──
const HISTORY_KEY = "wavejack_history";
export function getHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
export function addHistory(item: HistoryItem) {
  const list = [item, ...getHistory()].slice(0, 200);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

// ── SUPABASE HISTORY ──
export async function addHistoryDB(songId: number | null, item: HistoryItem) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    await supabase.from("search_history").insert({
      user_id: session.user.id,
      song_id: songId,
      searched_at: new Date(item.at).toISOString(),
    });
  } catch { /* non-critical */ }
}

export async function getHistoryDB(): Promise<HistoryItem[]> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return [];
    const { data } = await supabase
      .from("search_history")
      .select("searched_at, songs(title, artist)")
      .eq("user_id", session.user.id)
      .order("searched_at", { ascending: false })
      .limit(100);
    if (!data) return [];
    return data.map((row: any) => ({
      title: row.songs?.title || "Unknown",
      artist: row.songs?.artist || "Unknown",
      confidence: 0, hashes_matched: 0,
      at: new Date(row.searched_at).getTime(),
    }));
  } catch { return []; }
}

// ── ADMIN ──
export function isAdmin(u: AuthUser | null) {
  return !!u && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// ── GUEST ──
const USES_KEY = "wavejack_guest_uses";
export function getGuestUses(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(USES_KEY) || "0", 10);
}
export function incGuestUses() {
  localStorage.setItem(USES_KEY, String(getGuestUses() + 1));
}

// ── LOCAL USER CACHE ──
const KEY = "wavejack_user";
export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function setUser(u: AuthUser | null) {
  if (u) localStorage.setItem(KEY, JSON.stringify(u));
  else localStorage.removeItem(KEY);
}

// ── AUTH MODAL ──
interface AuthModalProps {
  mode: "signin" | "signup" | null;
  onClose: () => void;
  onAuth: (user: AuthUser) => void;
  onSwitchMode?: (mode: "signin" | "signup") => void;
}

export function AuthModal({ mode, onClose, onAuth, onSwitchMode }: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setEmail(""); setPassword(""); setName(""); setError(null); }, [mode]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true); setError(null);
    try {
      let authError: string | null = null;
      if (mode === "signup") {
        const { error: err } = await supabase.auth.signUp({
          email, password,
          options: { data: { name: name || email.split("@")[0] } },
        });
        authError = err?.message || null;
        if (!authError) {
          try {
            await supabase.from("users").insert({
              username: name || email.split("@")[0],
              email, password_hash: "supabase_auth",
            });
          } catch { /* ignore */ }
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        authError = err?.message || null;
      }

      if (authError && !authError.includes("fetch") && !authError.includes("placeholder")) {
        setError(authError);
      } else {
        const u: AuthUser = { email, name: name || email.split("@")[0] };
        setUser(u); onAuth(u);
      }
    } catch {
      const u: AuthUser = { email, name: name || email.split("@")[0] };
      setUser(u); onAuth(u);
    } finally { setLoading(false); }
  };

  return (
    <AnimatePresence>
      {mode && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="glass w-full max-w-md rounded-2xl p-8"
            initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">{mode === "signin" ? "Welcome back" : "Create account"}</h2>
              <button onClick={onClose} className="text-white/60 hover:text-white"><X size={20} /></button>
            </div>
            <form onSubmit={handle} className="space-y-4">
              {mode === "signup" && (
                <input type="text" placeholder="Username" value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-white placeholder:text-white/40 focus:border-purple focus:outline-none" />
              )}
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 h-5 w-5 text-white/40" />
                <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 pl-11 pr-4 py-3 text-white placeholder:text-white/40 focus:border-purple focus:outline-none" />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 h-5 w-5 text-white/40" />
                <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-white/5 border border-white/10 pl-11 pr-4 py-3 text-white placeholder:text-white/40 focus:border-purple focus:outline-none" />
              </div>
              {error && <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-400">{error}</div>}
              <button type="submit" disabled={loading}
                className="w-full rounded-lg py-3 font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
                style={{ background: "var(--gradient-purple)", boxShadow: "var(--shadow-glow-purple)" }}>
                {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-white/40">
              {mode === "signin" ? "No account? " : "Already have one? "}
              <button className="text-white/70 underline hover:text-white"
                onClick={() => onSwitchMode?.(mode === "signin" ? "signup" : "signin")}>
                {mode === "signin" ? "Sign up free" : "Sign in"}
              </button>
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── LIMIT MODAL ──
export function LimitModal({ open, onClose, onSignup }: { open: boolean; onClose: () => void; onSignup: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="glass w-full max-w-md rounded-2xl p-8 text-center"
            initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--gradient-purple)" }}>
              <span className="text-3xl">🎵</span>
            </div>
            <h2 className="mb-2 text-2xl font-bold text-white">You've used your 2 free identifies</h2>
            <p className="mb-6 text-white/60">Sign up free for unlimited song identifications.</p>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-lg border border-white/15 py-3 text-white hover:bg-white/5">Maybe later</button>
              <button onClick={onSignup} className="flex-1 rounded-lg py-3 font-semibold text-white"
                style={{ background: "var(--gradient-purple)", boxShadow: "var(--shadow-glow-purple)" }}>Sign up free</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

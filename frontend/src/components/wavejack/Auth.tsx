import { useEffect, useId, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Lock } from "lucide-react";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type AuthError,
  type Session,
  type User,
} from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { API_URL } from "@/lib/config";
import { useDialog } from "@/lib/use-dialog";

export type AuthUser = { id: string; email: string; name: string };

export type HistoryItem = {
  title: string;
  artist: string;
  confidence: number;
  hashes_matched?: number;
  at: number;
};

// ── LOCAL HISTORY ──
const HISTORY_KEY = "wavejack_history";
export function getHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
export function addHistory(item: HistoryItem) {
  const list = [item, ...getHistory()].slice(0, 200);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

// ── SUPABASE HISTORY ──
export async function addHistoryDB(songId: number | null, item: HistoryItem) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return;
  const { error } = await supabase.from("search_history").insert({
    user_id: session.user.id,
    song_id: songId,
    searched_at: new Date(item.at).toISOString(),
  });
  if (error) console.error("[WaveJack] couldn't save search history:", error.message);
}

export async function getHistoryDB(): Promise<HistoryItem[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return [];
  const { data, error } = await supabase
    .from("search_history")
    .select("searched_at, songs(title, artist)")
    .eq("user_id", session.user.id)
    .order("searched_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`couldn't load search history: ${error.message}`);
  // No generated DB types; supabase-js may type the joined row as an object or an array.
  type Row = {
    searched_at: string;
    songs: { title: string; artist: string } | { title: string; artist: string }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const song = Array.isArray(row.songs) ? row.songs[0] : row.songs;
    return {
      title: song?.title || "Unknown",
      artist: song?.artist || "Unknown",
      confidence: 0,
      hashes_matched: 0,
      at: new Date(row.searched_at).getTime(),
    };
  });
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

// ── SESSION (Supabase is the only source of truth) ──
function toAuthUser(u: User): AuthUser {
  const email = u.email ?? "";
  const name = (u.user_metadata?.name as string | undefined) || email.split("@")[0];
  return { id: u.id, email, name };
}

// getSession() only reads what's stored in the browser. Once per page load, ask the
// auth server whether that session is real; if the server rejects it (forged,
// revoked, deleted user) drop it locally. Network errors keep it (offline is fine).
let sessionCheck: Promise<void> | null = null;
function validateStoredSessionOnce() {
  sessionCheck ??= (async () => {
    const { error } = await supabase.auth.getUser();
    if (error && isAuthApiError(error) && (error.status === 401 || error.status === 403)) {
      console.warn("[WaveJack] stored session was rejected by the auth server, signing out.");
      await supabase.auth.signOut({ scope: "local" });
    }
  })().catch((e) => console.error("[WaveJack] session check failed:", e));
  return sessionCheck;
}

/**
 * Current user, from supabase.auth.getSession() on mount and kept in sync by
 * onAuthStateChange (sign-in, sign-out, token refresh, other tabs).
 * `loading` is true until the stored session has been read.
 */
export function useAuth(): { user: AuthUser | null; loading: boolean } {
  const [state, setState] = useState<{ user: AuthUser | null; loading: boolean }>({
    user: null,
    loading: true,
  });

  useEffect(() => {
    // The old app cached a hand-written user object here; it must never be trusted again.
    try {
      localStorage.removeItem("wavejack_user");
    } catch {
      /* storage unavailable */
    }

    let active = true;
    // getSession and INITIAL_SESSION / TOKEN_REFRESHED report the same user repeatedly;
    // keep the old object so effects keyed on `user` don't re-run for nothing.
    const update = (session: Session | null) => {
      if (!active) return;
      const next = session ? toAuthUser(session.user) : null;
      setState((prev) => {
        const same =
          prev.user?.id === next?.id &&
          prev.user?.email === next?.email &&
          prev.user?.name === next?.name;
        return same && !prev.loading ? prev : { user: next, loading: false };
      });
    };
    supabase.auth.getSession().then(({ data }) => {
      update(data.session);
      if (data.session) validateStoredSessionOnce();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => update(session));
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  // A global sign-out needs the network; if it fails, still drop the session on this device.
  if (error) {
    console.error("[WaveJack] sign-out request failed, clearing local session:", error.message);
    await supabase.auth.signOut({ scope: "local" });
  }
}

// ── ADMIN ──
// The backend decides who is an admin (backend/auth.py, ADMIN_EMAILS); the
// frontend only asks, so no admin address ships in the JS bundle.

/** Authorization header for backend calls made as the signed-in user. */
export async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/** GET /admin/me: the backend verifies the token with Supabase and checks the admin list. */
export async function verifyAdmin(): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers.Authorization) return false;
  try {
    const r = await fetch(`${API_URL}/admin/me`, { headers });
    return r.ok;
  } catch {
    return false;
  }
}

const adminChecks = new Map<string, Promise<boolean>>();

/** Whether to show admin UI for this user — asked once per user per page load. */
export function useIsAdmin(userId: string | undefined): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    if (!adminChecks.has(userId)) adminChecks.set(userId, verifyAdmin());
    adminChecks.get(userId)!.then((ok) => {
      if (active) setIsAdmin(ok);
    });
    return () => {
      active = false;
    };
  }, [userId]);
  return isAdmin;
}

// ── ERROR MESSAGES ──
function describeAuthError(err: AuthError): string {
  if (isAuthRetryableFetchError(err)) {
    return "Couldn't reach the sign-in server. Check your connection and try again.";
  }
  switch (err.code) {
    // Supabase deliberately returns the same error for "no such account" and
    // "wrong password", so the two can't (and shouldn't) be told apart.
    case "invalid_credentials":
      return "Incorrect email or password. No account yet? Sign up instead.";
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the confirmation link.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead.";
    case "weak_password":
      return err.message;
    case "email_address_invalid":
      return "That email address isn't valid.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "New sign-ups are currently disabled.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
  }
  if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
  return err.message || "Something went wrong. Please try again.";
}

// ── AUTH MODAL ──
interface AuthModalProps {
  mode: "signin" | "signup" | null;
  onClose: () => void;
  /** Called once a session exists. The session itself reaches the app via useAuth(). */
  onAuth: () => void;
  onSwitchMode?: (mode: "signin" | "signup") => void;
}

export function AuthModal({ mode, onClose, onAuth, onSwitchMode }: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useDialog<HTMLDivElement>(!!mode, onClose);
  const id = useId();

  useEffect(() => {
    setEmail("");
    setPassword("");
    setName("");
    setError(null);
    setNotice(null);
  }, [mode]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    setNotice(null);
    if (!isSupabaseConfigured) {
      setError("Sign-in is unavailable: Supabase isn't configured for this app.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const username = name || email.split("@")[0];
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: username } },
        });
        if (err) {
          setError(describeAuthError(err));
          return;
        }
        // With email confirmation on, Supabase hides existing accounts by
        // returning a user with no identities instead of an error.
        if (data.user && data.user.identities?.length === 0) {
          setError("An account with this email already exists. Sign in instead.");
          return;
        }
        if (!data.session) {
          setNotice(
            `Almost there — we sent a confirmation link to ${email}. Click it, then sign in.`,
          );
          return;
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) {
          setError(describeAuthError(err));
          return;
        }
      }
      onAuth();
    } catch (err) {
      console.error("[WaveJack] auth failed:", err);
      setError("Something went wrong — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {mode && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(5_3_10/0.78)] p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            className="panel panel-edge glow-violet w-full max-w-md rounded-2xl p-6 sm:p-8"
            initial={{ y: 8 }}
            animate={{ y: 0 }}
            exit={{ y: 8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="hairline-b mb-6 flex items-center justify-between pb-4">
              <h2
                id={`${id}-title`}
                className="font-display text-2xl font-semibold text-foreground"
              >
                {mode === "signin" ? "Welcome back" : "Create account"}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={handle} className="space-y-4">
              {mode === "signup" && (
                <input
                  aria-label="Username"
                  autoComplete="username"
                  type="text"
                  placeholder="Username"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field w-full px-4 py-3"
                />
              )}
              <div className="relative">
                <Mail
                  aria-hidden="true"
                  className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground"
                />
                <input
                  aria-label="Email"
                  autoComplete="email"
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field w-full py-3 pl-11 pr-4"
                />
              </div>
              <div className="relative">
                <Lock
                  aria-hidden="true"
                  className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground"
                />
                <input
                  aria-label="Password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field w-full py-3 pl-11 pr-4"
                />
              </div>
              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
              {notice && (
                <div
                  role="status"
                  className="rounded-xl border border-[rgb(192_132_252/0.3)] bg-[rgb(168_85_247/0.08)] px-4 py-2 text-sm text-foreground"
                >
                  {notice}
                </div>
              )}
              <button type="submit" disabled={loading} className="btn-primary w-full py-3">
                {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
              </button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {mode === "signin" ? "No account? " : "Already have one? "}
              <button
                type="button"
                className="text-accent-2 underline underline-offset-2 hover:text-foreground"
                onClick={() => onSwitchMode?.(mode === "signin" ? "signup" : "signin")}
              >
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
export function LimitModal({
  open,
  onClose,
  onSignup,
}: {
  open: boolean;
  onClose: () => void;
  onSignup: () => void;
}) {
  const panelRef = useDialog<HTMLDivElement>(open, onClose);
  const id = useId();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(5_3_10/0.78)] p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            className="panel panel-edge glow-violet w-full max-w-md rounded-2xl p-6 text-center sm:p-8"
            initial={{ y: 8 }}
            animate={{ y: 0 }}
            exit={{ y: 8 }}
          >
            <div
              aria-hidden="true"
              className="bg-gradient-button glow-pink font-signal mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-semibold text-white"
            >
              2/2
            </div>
            <h2
              id={`${id}-title`}
              className="font-display mb-2 text-2xl font-semibold text-foreground"
            >
              You've used your 2 free identifies
            </h2>
            <p className="mb-6 text-muted-foreground">
              Sign up free for unlimited song identifications.
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1 py-3">
                Maybe later
              </button>
              <button data-autofocus onClick={onSignup} className="btn-primary flex-1 py-3">
                Sign up free
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

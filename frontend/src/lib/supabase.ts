import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// createClient throws on an empty URL, which would crash every page at import time.
// Fall back to a placeholder so the app still loads in guest mode; Auth.tsx checks
// isSupabaseConfigured and refuses to sign anyone in when it's false.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  console.warn(
    "[WaveJack] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — auth and synced history are disabled. See frontend/.env.example.",
  );
}

export const supabase = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_ANON_KEY || "placeholder-anon-key",
);

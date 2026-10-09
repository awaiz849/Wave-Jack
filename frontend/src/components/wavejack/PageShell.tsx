import { Link } from "@tanstack/react-router";
import { AudioWaveform } from "lucide-react";
import { useAuth, useIsAdmin } from "@/components/wavejack/Auth";

const navLinkClass =
  "rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground";
const navLinkActiveClass =
  "rounded-lg px-3 py-1.5 text-sm text-foreground bg-[rgb(168_85_247/0.18)] shadow-[inset_0_0_0_1px_rgb(192_132_252/0.25)]";

/**
 * Shared app chrome — wordmark, primary nav, hairline rule underneath.
 * Used by every page, including the landing screen. `rightSlot` lets a page
 * swap in its own right-aligned content (landing page needs sign-in/up/guest
 * count; everything else just needs a greeting).
 */
export function PageShell({
  children,
  rightSlot,
  bare = false,
}: {
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
  bare?: boolean;
}) {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user?.id);

  return (
    <div className="page-backdrop min-h-screen">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:text-foreground"
      >
        Skip to content
      </a>
      <div className="px-4 pt-4 sm:px-6">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-[var(--border)] bg-[rgb(20_16_29/0.92)] px-4 py-3 sm:px-5"
        >
          <Link to="/" className="flex items-center gap-3" aria-label="WaveJack home">
            <span
              aria-hidden="true"
              className="bg-gradient-icon flex h-9 w-9 items-center justify-center rounded-xl p-px"
            >
              <span className="flex h-full w-full items-center justify-center rounded-[11px] bg-[var(--card)]">
                <AudioWaveform size={18} className="text-accent-2" />
              </span>
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-display text-base font-bold tracking-tight text-foreground">
                WaveJack
              </span>
              <span className="font-signal text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                audio fingerprinting
              </span>
            </span>
          </Link>

          {/* On phones the links drop to their own row under the logo instead of disappearing. */}
          <div className="order-last flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-white/[0.02] p-1 md:order-none md:w-auto">
            <Link
              to="/"
              className={navLinkClass}
              activeOptions={{ exact: true }}
              activeProps={{ className: navLinkActiveClass }}
            >
              Home
            </Link>
            <Link
              to="/history"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
            >
              History
            </Link>
            <Link
              to="/discover"
              className={navLinkClass}
              activeProps={{ className: navLinkActiveClass }}
            >
              Discover
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className={navLinkClass}
                activeProps={{ className: navLinkActiveClass }}
              >
                Admin
              </Link>
            )}
          </div>

          <div className="flex items-center gap-3">
            {rightSlot ?? (
              <span className="text-sm text-muted-foreground">
                {user ? `Hi, ${user.name}` : ""}
              </span>
            )}
          </div>
        </nav>
      </div>

      <main
        id="content"
        tabIndex={-1}
        className={`outline-none ${bare ? "" : "mx-auto max-w-6xl px-6 pb-20 pt-10 sm:px-10"}`}
      >
        {children}
      </main>
    </div>
  );
}

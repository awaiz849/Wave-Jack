import { Link } from "@tanstack/react-router";
import { AudioWaveform } from "lucide-react";
import { useAuth, useIsAdmin } from "@/components/wavejack/Auth";

const navLinkClass = "text-sm text-muted-foreground transition-colors hover:text-foreground";
const navLinkActiveClass = "text-sm text-foreground";

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
    <div className="min-h-screen">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:text-foreground"
      >
        Skip to content
      </a>
      <nav
        aria-label="Main"
        className="hairline-b flex flex-wrap items-center justify-between gap-y-4 px-6 py-5 sm:px-10"
      >
        <Link to="/" className="flex items-center gap-2" aria-label="WaveJack home">
          <AudioWaveform size={20} aria-hidden="true" style={{ color: "var(--accent)" }} />
          <span className="font-display text-lg font-bold tracking-tight text-foreground">
            WaveJack
          </span>
        </Link>

        {/* On phones the links drop to their own row under the logo instead of disappearing. */}
        <div className="order-last flex w-full items-center gap-6 md:order-none md:w-auto md:gap-8">
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
            <span className="text-sm text-muted-foreground">{user ? `Hi, ${user.name}` : ""}</span>
          )}
        </div>
      </nav>

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

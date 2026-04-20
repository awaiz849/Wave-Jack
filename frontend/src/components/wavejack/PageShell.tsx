import { Link } from "@tanstack/react-router";
import { AudioWaveform } from "lucide-react";
import { ParticleField, WaveRibbons } from "@/components/wavejack/Visuals";
import { getUser, isAdmin, type AuthUser } from "@/components/wavejack/Auth";
import { useEffect, useState } from "react";

export function PageShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => setUser(getUser()), []);
  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticleField />
      <WaveRibbons />
      <nav className="relative z-20 flex items-center justify-between px-8 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "var(--gradient-purple)", boxShadow: "0 0 20px oklch(0.62 0.22 295 / 0.6)" }}
          >
            <AudioWaveform size={20} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">WaveJack</span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          <Link to="/" className="text-sm text-white/60 hover:text-white" activeOptions={{ exact: true }} activeProps={{ className: "text-sm text-white" }}>Home</Link>
          <Link to="/history" className="text-sm text-white/60 hover:text-white" activeProps={{ className: "text-sm text-white" }}>History</Link>
          <Link to="/discover" className="text-sm text-white/60 hover:text-white" activeProps={{ className: "text-sm text-white" }}>Discover</Link>
          {isAdmin(user) && (
            <Link to="/admin" className="text-sm text-cyan hover:text-white" activeProps={{ className: "text-sm text-white" }}>Admin</Link>
          )}
        </div>
        <div className="text-sm text-white/60">{user ? `Hi, ${user.name}` : ""}</div>
      </nav>
      <main className="relative z-10 px-8 pb-20">{children}</main>
    </div>
  );
}

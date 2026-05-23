import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-full bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-base font-semibold tracking-tight">
            <span aria-hidden>⚔️</span> AoE4 Portal
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavLink to="/">Dashboard</NavLink>
            <NavLink to="/games">Games</NavLink>
            <NavLink to="/notes/civs">Civs</NavLink>
            <NavLink to="/notes/matchups">Matchups</NavLink>
            <NavLink to="/notes/maps">Maps</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded px-2.5 py-1.5 text-stone-600 hover:bg-stone-100"
      activeProps={{ className: "bg-stone-900 text-white hover:bg-stone-900" }}
      activeOptions={{ exact: to === "/" }}
    >
      {children}
    </Link>
  );
}

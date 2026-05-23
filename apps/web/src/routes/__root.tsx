import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { TooltipProvider } from "../components/ui/index.ts";
import { api, qk, type Me, type SyncStatus } from "../lib/api.ts";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
});

const ROMAN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function toRoman(n: number): string {
  const map: Array<[number, string]> = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let result = "";
  for (const [v, s] of map) {
    while (n >= v) {
      result += s;
      n -= v;
    }
  }
  return result;
}

function todayLine(): string {
  const d = new Date();
  const weekday = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][d.getDay()];
  const day = d.getDate();
  const month = ROMAN_MONTHS[d.getMonth()];
  const year = toRoman(d.getFullYear());
  return `${weekday}, ${day} ${month} ${year}`;
}

function RootLayout() {
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.get<Me>("/me") });
  const sync = useQuery({
    queryKey: qk.syncStatus,
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 15000,
  });

  const lastSuccess = sync.data?.rows.reduce<number | null>(
    (acc, r) => (r.last_success_at && (!acc || r.last_success_at > acc) ? r.last_success_at : acc),
    null,
  );
  const tickerText = me.data?.aoe4world_profile_id
    ? lastSuccess
      ? `Reading from aoe4world · last sync ${relative(lastSuccess)} · ${me.data.display_name}`
      : `Linked to aoe4world as ${me.data.display_name} · awaiting first sync`
    : "No aoe4world profile linked — visit Settings to begin";

  return (
    <TooltipProvider delayDuration={150}>
      <div className="relative z-10 mx-auto" style={{ maxWidth: 1320 }}>
        <Masthead tickerText={tickerText} live={sync.data?.in_flight ?? false} />
        <main>
          <Outlet />
        </main>
        <Colophon />
      </div>
    </TooltipProvider>
  );
}

function Masthead({ tickerText, live }: { tickerText: string; live: boolean }) {
  return (
    <header className="pt-12 pb-4 px-10">
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-6 text-[#5b574e]">
          <span className="eyebrow">Vol. III</span>
          <span className="eyebrow">No. 7</span>
          <span className="eyebrow">Spring Edition</span>
        </div>
        <div className="eyebrow">{todayLine()}</div>
      </div>

      <hr className="rule-faint mt-3" />

      <div className="flex items-center justify-center pt-8 pb-2">
        <span className="ornament">— &nbsp; § &nbsp; —</span>
      </div>

      <h1
        className="font-display text-center text-[#1c1c1a]"
        style={{
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 0.95,
        }}
      >
        The Templar Almanac
      </h1>

      <p
        className="font-display italic text-center text-[#5b574e] pt-3"
        style={{ fontSize: 19 }}
      >
        A private record of campaigns waged on the ranked ladder
        <span className="stitch" /> kept by one player, in good faith
      </p>

      <div className="flex items-center justify-center pt-6">
        <hr className="rule-gold flex-1" />
        <span className="eyebrow-tight mx-6 text-[#7a6a4a]">
          Established Anno Domini MMXXIV
        </span>
        <hr className="rule-gold flex-1" />
      </div>

      <nav className="flex items-center justify-center gap-2 pt-8 pb-1">
        <NavLink to="/" exact>The Lead</NavLink>
        <Dot />
        <NavLink to="/games">Ledger</NavLink>
        <Dot />
        <NavLink to="/notes/matchups">Matchups</NavLink>
        <Dot />
        <NavLink to="/notes/civs">Civs</NavLink>
        <Dot />
        <NavLink to="/notes/maps">Atlas</NavLink>
        <Dot />
        <NavLink to="/settings">Settings</NavLink>
      </nav>

      <div className="flex items-end justify-between pt-5">
        <div className="ticker">
          <span className={live ? "live" : ""}>{tickerText}</span>
        </div>
        <div className="folio">page i</div>
      </div>
    </header>
  );
}

function Dot() {
  return <span className="text-[#7a6a4a]">·</span>;
}

function NavLink({
  to,
  exact,
  children,
}: {
  to: string;
  exact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="nav-link"
      activeProps={{ className: "nav-link active" }}
      activeOptions={{ exact: exact ?? false }}
    >
      {children}
    </Link>
  );
}

function Colophon() {
  return (
    <footer className="px-10 pb-16">
      <div className="flex items-center justify-center py-4">
        <hr className="rule-gold flex-1" />
        <span className="ornament mx-6">— § —</span>
        <hr className="rule-gold flex-1" />
      </div>
      <div className="text-center pt-4">
        <p className="eyebrow pb-3">Colophon</p>
        <p
          className="font-display italic"
          style={{ fontSize: 17, color: "#5b574e", lineHeight: 1.6 }}
        >
          The Templar Almanac is set in Cormorant Garamond and Inter Tight.
          Records compiled from aoe4world.com, synchronised hourly. Maintained
          privately, for one reader only.
        </p>
        <p className="folio pt-5">— fin. —</p>
      </div>
    </footer>
  );
}

function relative(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function SectionDivider() {
  return (
    <div className="px-10">
      <div className="flex items-center justify-center py-4">
        <hr className="rule-faint flex-1" />
        <span className="ornament mx-6">— § —</span>
        <hr className="rule-faint flex-1" />
      </div>
    </div>
  );
}

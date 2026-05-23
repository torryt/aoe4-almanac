import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { KNIGHTS_TEMPLAR } from "@aoe4-almanac/shared";
import { api, qk, type GameDto, type Me, type SyncStatus } from "../lib/api.ts";
import { useSyncEvents } from "../lib/useSyncEvents.ts";
import { useCivNames } from "../lib/civNames.ts";
import { Spinner } from "../components/Spinner.tsx";
import { SectionDivider } from "./__root.tsx";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

type RecentStats = {
  recent: Array<Record<string, unknown>>;
  total_games: number;
  last_30d: {
    games: number;
    wins: number;
    losses: number;
    win_rate: number | null;
  };
};

function fmtDay(unix: number): string {
  const d = new Date(unix * 1000);
  const month = d.toLocaleString(undefined, { month: "short" });
  return `${d.getDate()} ${month}`;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function Dashboard() {
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.get<Me>("/me") });
  const { nameOf } = useCivNames();
  const recent = useQuery({
    queryKey: qk.games({ limit: 10 }),
    queryFn: () => api.get<{ games: GameDto[] }>("/games?limit=10"),
  });
  const stats = useQuery({
    queryKey: qk.statsRecent,
    queryFn: () => api.get<RecentStats>("/stats/recent"),
  });
  const sync = useQuery({
    queryKey: qk.syncStatus,
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 5000,
  });
  const progress = useSyncEvents();

  const linked =
    me.data?.aoe4world_profile_id !== null &&
    me.data?.aoe4world_profile_id !== undefined;

  const games30 = stats.data?.last_30d.games ?? 0;
  const wins30 = stats.data?.last_30d.wins ?? 0;
  const losses30 = stats.data?.last_30d.losses ?? 0;
  const wr30 = stats.data?.last_30d.win_rate;
  const games = recent.data?.games ?? [];

  // Find current streak
  let streak = 0;
  let streakKind: "W" | "L" | null = null;
  for (const g of games) {
    if (!streakKind && (g.my_result === "win" || g.my_result === "loss")) {
      streakKind = g.my_result === "win" ? "W" : "L";
      streak = 1;
    } else if (streakKind === "W" && g.my_result === "win") streak++;
    else if (streakKind === "L" && g.my_result === "loss") streak++;
    else break;
  }

  // Median duration
  const durations = games
    .map((g) => g.duration_seconds)
    .filter((d): d is number => d !== null && d > 0)
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations[Math.floor(durations.length / 2)] ?? null
    : null;

  // Rating from latest game
  const latestRated = games.find((g) => g.my_rating !== null);
  const latestRating = latestRated?.my_rating ?? null;
  const seasonDelta = games
    .map((g) => g.my_rating_diff ?? 0)
    .reduce((a, b) => a + b, 0);

  return (
    <>
      <section className="spread px-10 pt-16 pb-20">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-8">
            <div className="flex items-center gap-4">
              <span className="eyebrow">The Lead</span>
              <hr className="rule-faint flex-1" />
              <span className="eyebrow">Last 30 days</span>
            </div>

            <p
              className="font-display italic text-[#5b574e] pt-8"
              style={{ fontSize: 22, lineHeight: 1.35 }}
            >
              In which the proprietor has, in the last thirty days, played
            </p>

            <div className="flex items-baseline gap-8 pt-2">
              <div className="number-mega">
                {games30}
                <span className="denom" style={{ fontSize: 96 }}>
                  g
                </span>
              </div>
              <div className="pb-4 max-w-[280px]">
                <p
                  className="font-display"
                  style={{ fontSize: 19, lineHeight: 1.35 }}
                >
                  ranked &amp; recorded matches as the{" "}
                  <span className="text-[#9b2b2b] font-semibold">
                    proprietor
                  </span>
                  , advancing the rating by{" "}
                  <span className="font-semibold">
                    {seasonDelta >= 0 ? "+" : ""}
                    {seasonDelta}
                  </span>{" "}
                  in the period observed.
                </p>
              </div>
            </div>

            <p className="kicker pt-6">
              <span className="smallcaps text-[#5b574e]">In summary</span> —{" "}
              {wins30} victories against {losses30} defeats
              {wr30 !== null && wr30 !== undefined && (
                <>
                  ; a win rate of {(wr30 * 100).toFixed(1)} percent across the
                  period
                </>
              )}
              .
            </p>

            <hr className="rule mt-10" />

            <div className="grid grid-cols-5 pt-6 gap-6">
              <Stat
                label="Record"
                value={`${wins30}–${losses30}`}
                hint={
                  wr30 !== null && wr30 !== undefined
                    ? `${(wr30 * 100).toFixed(1)}%`
                    : "—"
                }
              />
              <Stat
                label="Rating"
                value={latestRating ?? "—"}
                hint={
                  seasonDelta !== 0
                    ? `${seasonDelta > 0 ? "↑" : "↓"} ${seasonDelta > 0 ? "+" : ""}${seasonDelta}`
                    : "no movement"
                }
                hintRed={seasonDelta > 0}
              />
              <Stat
                label="Streak"
                value={streakKind ? `${streakKind}${streak}` : "—"}
                hint="current"
              />
              <Stat
                label="Median"
                value={fmtDuration(median)}
                hint="game duration"
              />
              <Stat
                label="Games"
                value={stats.data?.total_games ?? 0}
                hint="on file"
              />
            </div>
          </div>

          <aside className="col-span-4 border-l border-[rgba(28,28,26,0.15)] pl-8">
            <div className="eyebrow-tight pb-4">From the desk</div>
            <p className="marginalia">
              The figure to the left counts all imported and manually-logged
              games within the last thirty days. Quick-match, custom lobbies and
              the occasional Treaty are tallied alongside ranked entries —
              filters are applied in the bound Ledger.
            </p>

            <hr className="rule-faint my-6" />

            <div className="eyebrow-tight pb-3">By the numbers</div>
            <dl className="stat-block">
              <dt>Player</dt>
              <dd>{me.data?.display_name ?? "—"}</dd>
              <dt>Profile</dt>
              <dd>
                {me.data?.aoe4world_profile_id ? (
                  <span className="text-[#9b2b2b]">
                    #{me.data.aoe4world_profile_id}
                  </span>
                ) : (
                  <em>unlinked</em>
                )}
              </dd>
              <dt>Last sync</dt>
              <dd>
                {sync.data?.in_flight ? (
                  <span className="flex items-center gap-1.5">
                    <Spinner size={12} /> running…
                  </span>
                ) : sync.data?.rows[0]?.last_success_at ? (
                  fmtDay(sync.data.rows[0].last_success_at)
                ) : (
                  "—"
                )}
              </dd>
              <dt>Status</dt>
              <dd>
                {linked ? (
                  "syncing"
                ) : (
                  <span className="text-[#9b2b2b]">
                    <Link to="/settings" className="underline">
                      not linked
                    </Link>
                  </span>
                )}
              </dd>
            </dl>

            <hr className="rule-faint my-6" />

            <div className="eyebrow-tight pb-3">Quick passage</div>
            <ul className="space-y-2 font-display text-[15px]">
              <li>
                <Link
                  to="/notes/civs/$slug"
                  params={{ slug: KNIGHTS_TEMPLAR }}
                  className="hover:underline"
                >
                  → Templar general notes
                </Link>
              </li>
              <li>
                <Link
                  to="/notes/matchups"
                  search={{ my_civ: KNIGHTS_TEMPLAR }}
                  className="hover:underline"
                >
                  → Templar matchup table
                </Link>
              </li>
              <li>
                <Link
                  to="/games"
                  search={{ civ: KNIGHTS_TEMPLAR }}
                  className="hover:underline"
                >
                  → My Templar campaigns
                </Link>
              </li>
            </ul>

            {progress.active && (
              <div className="mt-6 border-l-2 border-[#9b2b2b] pl-3">
                <div className="eyebrow-tight pb-2 flex items-center gap-2">
                  <Spinner size={10} /> Sync running
                </div>
                <p className="marginalia">
                  Page {progress.page} · {progress.imported_so_far} new game
                  {progress.imported_so_far === 1 ? "" : "s"} imported
                </p>
              </div>
            )}
          </aside>
        </div>
      </section>

      <SectionDivider />

      <section className="spread px-10 pt-12 pb-20">
        <div className="grid grid-cols-12 gap-10">
          <div className="col-span-3">
            <div className="eyebrow-tight pb-4">The Ledger</div>
            <h2
              className="font-display text-[#1c1c1a]"
              style={{
                fontSize: 56,
                lineHeight: 0.95,
                fontWeight: 700,
                letterSpacing: "-0.015em",
              }}
            >
              Recently
              <br />
              Played.
            </h2>
            <p className="kicker pt-4" style={{ fontSize: 14 }}>
              The last ten matches, in order of occurrence; freshest at the top.
            </p>
            <hr className="rule-gold my-6" />
            <p className="marginalia">
              Losses are set in{" "}
              <span className="text-[#9b2b2b] font-semibold">red</span>; the
              rating column carries its own sign.
            </p>
            <div className="mt-6">
              <Link to="/games" className="nav-link">
                Full Ledger →
              </Link>
            </div>
          </div>

          <div className="col-span-9">
            <div
              className="log-row"
              style={{
                borderBottom: "2px solid #1c1c1a",
                paddingBottom: 8,
                paddingTop: 0,
              }}
            >
              <div className="eyebrow-tight">Date</div>
              <div className="eyebrow-tight">Matchup</div>
              <div className="eyebrow-tight">Map</div>
              <div className="eyebrow-tight text-right">Duration</div>
              <div className="eyebrow-tight text-center">Result</div>
              <div className="eyebrow-tight text-right">Δ MMR</div>
            </div>

            {recent.isLoading ? (
              <div className="kicker py-6">Loading the ledger…</div>
            ) : games.length === 0 ? (
              <div className="kicker py-6">
                No games yet. {linked ? "Sync should populate them shortly." : (
                  <>
                    <Link to="/settings" className="underline">
                      Link aoe4world
                    </Link>{" "}
                    or{" "}
                    <Link to="/games/new" className="underline">
                      log a manual game
                    </Link>
                    .
                  </>
                )}
              </div>
            ) : (
              games.map((g) => {
                const opp = g.participants.find((p) => !p.is_self);
                return (
                  <Link
                    key={g.id}
                    to="/games/$gameId"
                    params={{ gameId: String(g.id) }}
                    className="log-row hover:bg-[rgba(28,28,26,0.04)]"
                  >
                    <div
                      className="font-display"
                      style={{ fontSize: 17, fontWeight: 600 }}
                    >
                      {fmtDay(g.started_at)}
                    </div>
                    <div className="font-display" style={{ fontSize: 17 }}>
                      <span className="text-[#9b2b2b]">{nameOf(g.my_civ_slug)}</span>{" "}
                      <span className="text-[#5b574e] italic">vs</span>{" "}
                      {opp ? (
                        <span>{nameOf(opp.civ_slug)}</span>
                      ) : (
                        <span className="text-[#5b574e] italic">—</span>
                      )}
                    </div>
                    <div className="font-display italic" style={{ fontSize: 16 }}>
                      {g.map_slug ? prettyMap(g.map_slug) : "—"}
                    </div>
                    <div
                      className="font-display text-right"
                      style={{ fontSize: 16, fontWeight: 500 }}
                    >
                      {fmtDuration(g.duration_seconds)}
                    </div>
                    <div
                      className={`text-center font-display ${
                        g.my_result === "win"
                          ? "result-W"
                          : g.my_result === "loss"
                            ? "result-L"
                            : "result-D"
                      }`}
                      style={{ fontSize: 17 }}
                    >
                      {g.my_result === "win"
                        ? "W"
                        : g.my_result === "loss"
                          ? "L"
                          : g.my_result === "draw"
                            ? "D"
                            : "—"}
                    </div>
                    <div
                      className={`font-display text-right ${g.my_rating_diff !== null && g.my_rating_diff < 0 ? "text-[#9b2b2b]" : ""}`}
                      style={{ fontSize: 16 }}
                    >
                      {g.my_rating_diff === null
                        ? "—"
                        : g.my_rating_diff < 0
                          ? `−${Math.abs(g.my_rating_diff)}`
                          : `+${g.my_rating_diff}`}
                    </div>
                  </Link>
                );
              })
            )}

            <div className="flex items-center justify-between pt-6">
              <span className="kicker">
                Continued in the{" "}
                <Link to="/games" className="underline">
                  bound Ledger
                </Link>
                .
              </span>
              <span className="folio">page 1</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  hintRed,
}: {
  label: string;
  value: string | number;
  hint?: string;
  hintRed?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow-tight pb-3">{label}</div>
      <div
        className="font-display"
        style={{ fontSize: 44, lineHeight: 1, fontWeight: 600 }}
      >
        {value}
      </div>
      {hint && (
        <div className="kicker pt-2" style={{ fontSize: 13 }}>
          <span className={hintRed ? "text-[#9b2b2b]" : ""}>{hint}</span>
        </div>
      )}
    </div>
  );
}

export { prettyCivName as prettyCiv } from "@aoe4-almanac/shared";

export function prettyMap(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { KNIGHTS_TEMPLAR } from "@aoe4-almanac/shared";
import {
  api,
  qk,
  type GameDto,
  type Me,
  type RatingHistory,
  type RatingInfo,
  type SyncStatus,
} from "../lib/api.ts";
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

  const linked =
    me.data?.aoe4world_profile_id !== null &&
    me.data?.aoe4world_profile_id !== undefined;

  const recent = useQuery({
    queryKey: qk.games({ limit: 10 }),
    queryFn: () => api.get<{ games: GameDto[] }>("/games?limit=10"),
    enabled: linked,
  });
  const stats = useQuery({
    queryKey: qk.statsRecent,
    queryFn: () => api.get<RecentStats>("/stats/recent"),
    enabled: linked,
  });
  const sync = useQuery({
    queryKey: qk.syncStatus,
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 5000,
    enabled: linked,
  });
  const ratingInfo = useQuery({
    queryKey: qk.ratingInfo("rm_solo"),
    queryFn: () => api.get<RatingInfo>("/me/rating-info?leaderboard=rm_solo"),
    enabled: linked,
    staleTime: 60_000,
  });
  const progress = useSyncEvents();

  if (me.isLoading) {
    return (
      <section className="spread px-10 pt-16 pb-20">
        <p className="kicker">Loading…</p>
      </section>
    );
  }

  if (!linked) {
    return <UnlinkedEmptyState />;
  }

  const games30 = stats.data?.last_30d.games ?? 0;
  const wins30 = stats.data?.last_30d.wins ?? 0;
  const losses30 = stats.data?.last_30d.losses ?? 0;
  const wr30 = stats.data?.last_30d.win_rate;
  const games = recent.data?.games ?? [];

  // Median duration
  const durations = games
    .map((g) => g.duration_seconds)
    .filter((d): d is number => d !== null && d > 0)
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations[Math.floor(durations.length / 2)] ?? null
    : null;

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

            <div className="grid grid-cols-3 pt-6 gap-6">
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

      <StandingSection info={ratingInfo.data} linked={linked} />

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

function StandingSection({
  info,
  linked,
}: {
  info: RatingInfo | undefined;
  linked: boolean;
}) {
  const [range, setRange] = useState<"recent" | "all">("recent");
  const limit = range === "recent" ? 60 : 20000;
  const ratingHistory = useQuery({
    queryKey: [...qk.ratingHistory("rm_solo"), range] as const,
    queryFn: () =>
      api.get<RatingHistory>(
        `/stats/rating-history?leaderboard=rm_solo&limit=${limit}`,
      ),
    enabled: linked,
  });
  const history = ratingHistory.data?.points ?? [];

  return (
    <section className="spread px-10 pt-12 pb-12">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-3">
          <div className="eyebrow-tight pb-4">The Standing</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 56,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            Where the
            <br />
            proprietor
            <br />
            <em className="text-[#9b2b2b]">stands.</em>
          </h2>
          <hr className="rule-gold my-6" />
          <p className="marginalia">
            Ratings and standings as reported by{" "}
            <span className="italic">aoe4world</span> for the current ranked
            solo season.
          </p>
        </div>

        <div className="col-span-9">
          {!info ? (
            <div className="kicker py-6">Consulting the registry…</div>
          ) : info.unranked ? (
            <div className="kicker py-6 italic">
              No ranked standing on file for the current season.
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-4">
                <div className="eyebrow-tight pb-3">Current Rating</div>
                <div className="flex items-baseline gap-3">
                  <div
                    className="font-display"
                    style={{ fontSize: 84, lineHeight: 0.9, fontWeight: 700 }}
                  >
                    {info.rating ?? "—"}
                  </div>
                  {info.max_rating != null &&
                    info.rating != null &&
                    info.max_rating > info.rating && (
                      <div className="font-display text-[#5b574e]" style={{ fontSize: 18 }}>
                        peak <span className="font-semibold">{info.max_rating}</span>
                      </div>
                    )}
                </div>
                <div className="kicker pt-2">
                  {info.streak != null && info.streak !== 0 && (
                    <>
                      Current streak{" "}
                      <span
                        className={
                          info.streak > 0
                            ? "font-semibold"
                            : "text-[#9b2b2b] font-semibold"
                        }
                      >
                        {info.streak > 0 ? `W${info.streak}` : `L${Math.abs(info.streak)}`}
                      </span>
                      {" · "}
                    </>
                  )}
                  {info.win_rate != null && (
                    <>{info.win_rate.toFixed(1)}% win rate</>
                  )}
                </div>

                <div className="mt-6">
                  <div className="flex justify-end pb-2">
                    <RangeToggle value={range} onChange={setRange} />
                  </div>
                  <Sparkline points={history} width={420} height={110} />
                </div>
              </div>

              <div className="col-span-4">
                <div className="eyebrow-tight pb-3">World</div>
                <div
                  className="font-display"
                  style={{ fontSize: 52, lineHeight: 1, fontWeight: 700 }}
                >
                  #{info.rank?.toLocaleString() ?? "—"}
                </div>
                <p className="kicker pt-2">
                  {info.rank_total != null && (
                    <>
                      of{" "}
                      <span className="font-semibold">
                        {info.rank_total.toLocaleString()}
                      </span>
                      {" "}ranked solo players
                    </>
                  )}
                </p>

                <hr className="rule-faint my-5" />

                <div className="eyebrow-tight pb-3">
                  {info.country
                    ? `Country · ${info.country.toUpperCase()}`
                    : "Country"}
                </div>
                <div
                  className="font-display"
                  style={{ fontSize: 52, lineHeight: 1, fontWeight: 700 }}
                >
                  {info.country_rank != null ? (
                    <>
                      <span className="text-[#9b2b2b]">#</span>
                      {info.country_rank.toLocaleString()}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
                <p className="kicker pt-2">
                  {info.country_total != null ? (
                    <>
                      of{" "}
                      <span className="font-semibold">
                        {info.country_total.toLocaleString()}
                      </span>{" "}
                      countrymen
                    </>
                  ) : info.country ? (
                    "country ranking unavailable"
                  ) : (
                    "no country on file"
                  )}
                </p>
              </div>

              <div className="col-span-4">
                <div className="eyebrow-tight pb-3">Placement</div>
                <LeagueBadge level={info.rank_level} />
                <p className="kicker pt-3">
                  {info.rank != null && info.rank_total != null && (
                    <>
                      Top{" "}
                      <span className="font-semibold">
                        {((info.rank / info.rank_total) * 100).toFixed(1)}%
                      </span>{" "}
                      of the field.
                    </>
                  )}
                </p>

                <hr className="rule-faint my-5" />

                <dl className="stat-block">
                  <dt>Season W–L</dt>
                  <dd>
                    {info.wins_count ?? 0}–{info.losses_count ?? 0}
                  </dd>
                  <dt>Games</dt>
                  <dd>{info.games_count ?? 0}</dd>
                  {info.max_rating != null && (
                    <>
                      <dt>Peak</dt>
                      <dd>{info.max_rating}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function RangeToggle({
  value,
  onChange,
}: {
  value: "recent" | "all";
  onChange: (v: "recent" | "all") => void;
}) {
  const btn = (key: "recent" | "all", label: string) => {
    const active = value === key;
    return (
      <button
        type="button"
        onClick={() => onChange(key)}
        className={`px-2 py-1 transition-colors ${
          active
            ? "text-[#9b2b2b] border-b border-[#9b2b2b]"
            : "text-[#5b574e] hover:text-[#1c1c1a]"
        }`}
        style={{
          fontFamily: "Inter Tight, sans-serif",
          fontSize: 9.5,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="flex items-center gap-1">
      {btn("recent", "60 g")}
      {btn("all", "All-time")}
    </div>
  );
}

function fmtSparkDate(unix: number): string {
  const d = new Date(unix * 1000);
  const month = d.toLocaleString(undefined, { month: "short" });
  return `${d.getDate()} ${month} ${d.getFullYear()}`;
}

function Sparkline({
  points,
  width = 320,
  height = 80,
}: {
  points: Array<{ at: number; rating: number }>;
  width?: number;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="kicker italic" style={{ fontSize: 12 }}>
        Not enough rated games to plot.
      </div>
    );
  }
  const pad = 4;
  const ratings = points.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    xs.push(pad + i * stepX);
    ys.push(pad + (height - pad * 2) * (1 - (p.rating - min) / range));
  }
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]?.toFixed(2)},${ys[i]?.toFixed(2)}`)
    .join(" ");
  const fillPath = `${path} L${xs[xs.length - 1]?.toFixed(2)},${(height - pad).toFixed(2)} L${pad},${(height - pad).toFixed(2)} Z`;
  const lastIdx = points.length - 1;
  const focusIdx = hoverIdx != null ? hoverIdx : lastIdx;
  const focusPoint = points[focusIdx];
  const focusX = xs[focusIdx] ?? 0;
  const focusY = ys[focusIdx] ?? 0;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xLocal = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round((xLocal - pad) / stepX);
    const clamped = Math.max(0, Math.min(points.length - 1, idx));
    setHoverIdx(clamped);
  };

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          style={{ display: "block", touchAction: "none" }}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverIdx(null)}
        >
          <path d={fillPath} fill="rgba(155,43,43,0.08)" />
          <path
            d={path}
            fill="none"
            stroke="#9b2b2b"
            strokeWidth={1.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hoverIdx != null && focusPoint && (
            <>
              <line
                x1={focusX}
                x2={focusX}
                y1={pad}
                y2={height - pad}
                stroke="#5b574e"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
              <circle cx={focusX} cy={focusY} r={3} fill="#9b2b2b" />
            </>
          )}
          {hoverIdx == null && (
            <circle cx={xs[lastIdx]} cy={ys[lastIdx]} r={2.5} fill="#9b2b2b" />
          )}
        </svg>
        {focusPoint && (
          <HoverTooltip
            x={focusX}
            y={focusY}
            width={width}
            height={height}
            point={focusPoint}
            active={hoverIdx != null}
          />
        )}
      </div>
      <div
        className="flex justify-between font-display text-[#5b574e] pt-1"
        style={{ fontSize: 12 }}
      >
        <span>
          {points[0] ? fmtSparkDate(points[0].at) : "—"}{" "}
          <span className="italic">· min {min}</span>
        </span>
        <span className="italic">
          {points.length} games · max {max}
        </span>
      </div>
    </div>
  );
}

function HoverTooltip({
  x,
  y,
  width,
  height,
  point,
  active,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  point: { at: number; rating: number };
  active: boolean;
}) {
  if (!active) return null;
  const leftPct = (x / width) * 100;
  const topPct = (y / height) * 100;
  const flipX = leftPct > 70;
  const flipY = topPct < 40;
  return (
    <div
      className="pointer-events-none absolute bg-[#1c1c1a] text-[#f1ece4] px-2.5 py-1.5"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: `translate(${flipX ? "calc(-100% - 10px)" : "10px"}, ${flipY ? "10px" : "calc(-100% - 10px)"})`,
        fontFamily: "Inter Tight, sans-serif",
        fontSize: 11,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        boxShadow: "0 2px 8px rgba(28,28,26,0.25)",
      }}
    >
      <div
        className="font-display"
        style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}
      >
        {point.rating}
        <span
          className="text-[#b8a87f] pl-1"
          style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 500 }}
        >
          ELO
        </span>
      </div>
      <div
        className="text-[#b8a87f] pt-0.5"
        style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase" }}
      >
        {fmtSparkDate(point.at)}
      </div>
    </div>
  );
}

function LeagueBadge({ level }: { level: string | null }) {
  if (!level) {
    return (
      <div
        className="font-display italic text-[#5b574e]"
        style={{ fontSize: 28 }}
      >
        Unranked
      </div>
    );
  }
  const pretty = level
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(\d)\b/, (m) => ["", "I", "II", "III", "IV"][Number(m)] ?? m);
  const isConq = level.startsWith("conqueror");
  return (
    <div>
      <div
        className="font-display"
        style={{
          fontSize: 36,
          lineHeight: 1,
          fontWeight: 700,
          color: isConq ? "#9b2b2b" : "#1c1c1a",
          letterSpacing: "-0.01em",
        }}
      >
        {pretty}
      </div>
    </div>
  );
}

function UnlinkedEmptyState() {
  return (
    <section className="spread px-10 pt-16 pb-24">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-8">
          <div className="flex items-center gap-4">
            <span className="eyebrow">Notice to the Reader</span>
            <hr className="rule-faint flex-1" />
            <span className="eyebrow">First edition</span>
          </div>

          <h2
            className="font-display text-[#1c1c1a] pt-8"
            style={{
              fontSize: 84,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            The Almanac
            <br />
            stands empty.
          </h2>

          <hr className="rule-gold my-6" />

          <p
            className="font-display italic text-[#5b574e]"
            style={{ fontSize: 22, lineHeight: 1.4, maxWidth: 620 }}
          >
            No campaigns have yet been entered into these pages. Bind the
            Almanac to your{" "}
            <span className="not-italic font-semibold text-[#9b2b2b]">
              aoe4world
            </span>{" "}
            profile, and the records shall fill themselves — automatically,
            and in good order.
          </p>

          <div className="pt-10 flex items-center gap-6">
            <Link
              to="/settings"
              className="font-display"
              style={{
                fontSize: 20,
                fontWeight: 600,
                background: "#9b2b2b",
                color: "#f1ece4",
                padding: "14px 28px",
                letterSpacing: "0.02em",
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              Link aoe4world profile →
            </Link>
            <span className="kicker italic">
              No account is created. Records are stored privately.
            </span>
          </div>

          <hr className="rule mt-12" />

          <div className="grid grid-cols-3 gap-8 pt-8">
            <Step
              n="i."
              title="Open the Desk"
              body={
                <>
                  Visit{" "}
                  <Link to="/settings" className="underline">
                    Settings
                  </Link>{" "}
                  — the proprietor's tools of the trade.
                </>
              }
            />
            <Step
              n="ii."
              title="Search your name"
              body="Type your in-game alias. A list of candidate profiles will appear from aoe4world."
            />
            <Step
              n="iii."
              title="Bind the Almanac"
              body="Confirm the match, and the records shall begin syncing forthwith."
            />
          </div>
        </div>

        <aside className="col-span-4 border-l border-[rgba(28,28,26,0.15)] pl-8">
          <div className="eyebrow-tight pb-4">From the desk</div>
          <p className="marginalia">
            Until a profile is bound, the Almanac shows no figures, holds no
            ledger, and renders no judgements. This is by design — there is
            nothing yet to remember.
          </p>

          <hr className="rule-faint my-6" />

          <div className="eyebrow-tight pb-3">What you gain, once linked</div>
          <ul className="space-y-3 font-display" style={{ fontSize: 16 }}>
            <Bullet>An auto-updating ledger of ranked matches</Bullet>
            <Bullet>Per-civilization win-rates and matchup tables</Bullet>
            <Bullet>An atlas of maps you have warred upon</Bullet>
            <Bullet>A dossier on every recurring opponent</Bullet>
            <Bullet>Private notes, kept beside each record</Bullet>
          </ul>

          <hr className="rule-faint my-6" />

          <p className="marginalia italic">
            The Almanac is read by one reader only — yourself.
          </p>
        </aside>
      </div>
    </section>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="font-display text-[#9b2b2b]"
        style={{ fontSize: 32, fontWeight: 600, lineHeight: 1 }}
      >
        {n}
      </div>
      <div
        className="font-display pt-2"
        style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}
      >
        {title}
      </div>
      <p
        className="font-display text-[#5b574e] pt-2"
        style={{ fontSize: 15, lineHeight: 1.5 }}
      >
        {body}
      </p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-[#9b2b2b]" style={{ lineHeight: 1.4 }}>
        §
      </span>
      <span style={{ lineHeight: 1.4 }}>{children}</span>
    </li>
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

import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api, qk, type GameDto, type Me, type SyncStatus } from "../lib/api.ts";
import { useSyncEvents } from "../lib/useSyncEvents.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";
import { ResultBadge } from "../components/ResultBadge.tsx";
import { Spinner } from "../components/Spinner.tsx";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function fmtDate(unix: number): string {
  try {
    return new Date(unix * 1000).toLocaleString();
  } catch {
    return String(unix);
  }
}

function Dashboard() {
  const me = useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<Me>("/me"),
  });
  const recent = useQuery({
    queryKey: qk.games({ limit: 8 }),
    queryFn: () => api.get<{ games: GameDto[] }>("/games?limit=8"),
  });
  const sync = useQuery({
    queryKey: qk.syncStatus,
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 5000,
  });
  const progress = useSyncEvents();

  const linked = me.data?.aoe4world_profile_id !== null && me.data?.aoe4world_profile_id !== undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card
          title="Recent games"
          actions={
            <Link to="/games" className="text-xs font-medium text-stone-500 hover:text-stone-900">
              View all →
            </Link>
          }
        >
          {!linked && (
            <div className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No aoe4world profile linked yet. <Link to="/settings" className="font-semibold underline">Link in Settings</Link> to auto-import.
            </div>
          )}
          {recent.isLoading ? (
            <div className="text-sm text-stone-500">Loading…</div>
          ) : (recent.data?.games ?? []).length === 0 ? (
            <div className="text-sm text-stone-500">
              No games yet.{" "}
              <Link to="/games/new" className="font-semibold underline">
                Add one manually
              </Link>
              .
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {recent.data?.games.map((g) => (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <ResultBadge result={g.my_result} />
                  <Link
                    to="/games/$gameId"
                    params={{ gameId: String(g.id) }}
                    className="flex-1 truncate text-sm hover:underline"
                  >
                    <CivBadge slug={g.my_civ_slug} size="xs" />
                    <span className="mx-1.5 text-stone-400">vs</span>
                    {(() => {
                      const opp = g.participants.find((p) => !p.is_self);
                      return opp ? <CivBadge slug={opp.civ_slug} size="xs" /> : <span className="text-stone-400 text-xs">—</span>;
                    })()}
                    <span className="ml-2 text-xs text-stone-500">{g.map_slug ?? ""}</span>
                  </Link>
                  <span className="text-xs text-stone-400 tabular-nums">{fmtDate(g.started_at)}</span>
                  {g.my_rating_diff !== null && (
                    <span className={`tabular-nums text-xs ${g.my_rating_diff > 0 ? "text-emerald-700" : g.my_rating_diff < 0 ? "text-rose-700" : "text-stone-500"}`}>
                      {g.my_rating_diff > 0 ? "+" : ""}
                      {g.my_rating_diff}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="KT quick links">
          <ul className="space-y-1 text-sm">
            <li>
              <Link to="/notes/civs/$slug" params={{ slug: "templar" }} className="text-stone-700 hover:underline">
                KT general notes →
              </Link>
            </li>
            <li>
              <Link to="/notes/matchups" search={{ my_civ: "templar" }} className="text-stone-700 hover:underline">
                KT matchups →
              </Link>
            </li>
            <li>
              <Link to="/games" search={{ civ: "templar" }} className="text-stone-700 hover:underline">
                My KT games →
              </Link>
            </li>
          </ul>
        </Card>

        <Card title="Sync">
          {progress.active && (
            <div className="mb-2 flex items-center gap-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              <Spinner size={12} />
              <span>
                page {progress.page} · {progress.imported_so_far} new games
                {progress.full ? " (full)" : ""}
              </span>
            </div>
          )}
          {sync.data?.rows.length === 0 ? (
            <div className="text-xs text-stone-500">No sync yet.</div>
          ) : (
            <div className="space-y-1 text-xs text-stone-600">
              {sync.data?.rows.map((r) => (
                <div key={r.leaderboard}>
                  <div className="font-medium text-stone-800">{r.leaderboard}</div>
                  <div>Last seen game: {r.last_seen_game_id ?? "—"}</div>
                  <div>Last poll: {r.last_polled_at ? fmtDate(r.last_polled_at) : "—"}</div>
                  {r.last_error && <div className="text-rose-700">Error: {r.last_error}</div>}
                </div>
              ))}
              {sync.data?.in_flight && !progress.active && (
                <div className="flex items-center gap-1.5 text-stone-500">
                  <Spinner size={12} /> Sync running…
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

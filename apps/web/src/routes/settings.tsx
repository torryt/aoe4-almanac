import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, qk, type Me, type SearchResult, type SyncStatus } from "../lib/api.ts";
import { useSyncEvents } from "../lib/useSyncEvents.ts";
import { Card } from "../components/Card.tsx";
import { Spinner } from "../components/Spinner.tsx";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString();
}

function Settings() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: qk.me, queryFn: () => api.get<Me>("/me") });
  const sync = useQuery({
    queryKey: qk.syncStatus,
    queryFn: () => api.get<SyncStatus>("/sync/status"),
    refetchInterval: 5000,
  });
  const progress = useSyncEvents();

  // Re-fetch /me when the link's player_fetched event fires (so UI reflects the
  // linked profile immediately, without polling).
  useEffect(() => {
    if (progress.last_event?.type === "link.player_fetched") {
      void qc.invalidateQueries({ queryKey: qk.me });
    }
    if (progress.last_event?.type === "sync.completed") {
      void qc.invalidateQueries({ queryKey: ["games"] });
      void qc.invalidateQueries({ queryKey: qk.syncStatus });
    }
  }, [progress.last_event, qc]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const linkMut = useMutation({
    mutationFn: (profile_id: number) =>
      api.post<{ ok: true }>("/me/link-aoe4world", { profile_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });

  const unlinkMut = useMutation({
    mutationFn: () => api.delete<{ ok: true }>("/me/link-aoe4world"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });

  const syncMut = useMutation({
    mutationFn: (full: boolean) => api.post<{ ok: true }>("/sync/run", { full }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.syncStatus }),
  });

  async function runSearch(): Promise<void> {
    setSearchErr(null);
    setSearching(true);
    try {
      const r = await api.get<{ players: SearchResult[] }>(
        `/aoe4world/search?q=${encodeURIComponent(query)}`,
      );
      setResults(r.players);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  // A link is "in progress" from the moment we click Link, through the player
  // fetch, until sync starts emitting events, until sync.completed.
  const linking = linkMut.isPending;
  const backfilling = progress.active;
  const showProgress =
    linking ||
    backfilling ||
    progress.error !== null ||
    (progress.completed !== null && Date.now() / 1000 - (progress.last_event?.ts ?? 0) < 8);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="aoe4world profile">
        {me.data && me.data.aoe4world_profile_id ? (
          <div className="space-y-3 text-sm">
            <div>
              Linked as <strong>{me.data.display_name}</strong> (profile{" "}
              <code className="rounded bg-stone-100 px-1 text-xs">
                {me.data.aoe4world_profile_id}
              </code>
              )
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => syncMut.mutate(false)}
                disabled={syncMut.isPending || backfilling}
                className="inline-flex items-center gap-1.5 rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {(syncMut.isPending || backfilling) && <Spinner size={12} />}
                Sync now
              </button>
              <button
                type="button"
                onClick={() => syncMut.mutate(true)}
                disabled={syncMut.isPending || backfilling}
                className="inline-flex items-center gap-1.5 rounded border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              >
                {(syncMut.isPending || backfilling) && <Spinner size={12} />}
                Full backfill
              </button>
              <button
                type="button"
                onClick={() => unlinkMut.mutate()}
                disabled={unlinkMut.isPending || backfilling}
                className="ml-auto inline-flex items-center gap-1.5 rounded border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                {unlinkMut.isPending && <Spinner size={12} />}
                Unlink
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-stone-600">
              Search for your in-game name to link your profile.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Your in-game name"
                disabled={linking}
                className="flex-1 rounded border border-stone-300 px-2 py-1.5 text-sm disabled:opacity-50"
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={query.length < 2 || searching || linking}
                className="inline-flex items-center gap-1.5 rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {searching && <Spinner size={12} />}
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
            {searchErr && <div className="text-xs text-rose-700">{searchErr}</div>}
            {results.length > 0 && (
              <ul className="divide-y divide-stone-100 rounded border border-stone-200">
                {results.map((p) => (
                  <li key={p.profile_id} className="flex items-center gap-3 px-3 py-2">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt="" className="size-8 rounded" />
                    ) : (
                      <div className="size-8 rounded bg-stone-200" />
                    )}
                    <div className="flex-1">
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-stone-500">
                        {p.country?.toUpperCase() ?? "—"} · last game:{" "}
                        {p.last_game_at
                          ? new Date(p.last_game_at).toLocaleDateString()
                          : "—"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => linkMut.mutate(p.profile_id)}
                      disabled={linkMut.isPending}
                      className="inline-flex items-center gap-1.5 rounded bg-stone-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {linkMut.isPending && linkMut.variables === p.profile_id && (
                        <Spinner size={12} />
                      )}
                      Link
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card title="Sync status">
        {showProgress && <SyncProgressPanel progress={progress} linking={linking} />}
        {sync.data?.rows.length === 0 ? (
          <div className="text-sm text-stone-500">No sync yet.</div>
        ) : (
          <div className="space-y-2 text-sm">
            {sync.data?.rows.map((r) => (
              <div key={r.leaderboard} className="rounded border border-stone-200 p-2">
                <div className="font-medium">{r.leaderboard}</div>
                <div className="text-xs text-stone-600">
                  <div>Last seen game: {r.last_seen_game_id ?? "—"}</div>
                  <div>Last poll: {fmtDate(r.last_polled_at)}</div>
                  <div>Last success: {fmtDate(r.last_success_at)}</div>
                  {r.last_error && (
                    <div className="text-rose-700">Error: {r.last_error}</div>
                  )}
                </div>
              </div>
            ))}
            <div className="text-xs text-stone-500">
              {sync.data?.in_flight ? "Sync running…" : "Idle."}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SyncProgressPanel({
  progress,
  linking,
}: {
  progress: ReturnType<typeof useSyncEvents>;
  linking: boolean;
}) {
  const status = progress.error
    ? "Failed"
    : progress.completed
      ? "Completed"
      : progress.active
        ? "Importing games…"
        : linking
          ? "Linking…"
          : "Waiting…";
  const accent = progress.error
    ? "border-rose-300 bg-rose-50"
    : progress.completed
      ? "border-emerald-300 bg-emerald-50"
      : "border-amber-300 bg-amber-50";

  return (
    <div className={`mb-3 rounded border ${accent} px-3 py-2 text-xs`}>
      <div className="flex items-center gap-2 font-medium">
        {(progress.active || linking) && <Spinner size={12} />}
        <span>{status}</span>
        {progress.display_name && (
          <span className="text-stone-500">· {progress.display_name}</span>
        )}
      </div>
      {(progress.active || progress.page > 0) && (
        <div className="mt-1 text-stone-700">
          page {progress.page} · {progress.imported_so_far} new game
          {progress.imported_so_far === 1 ? "" : "s"} imported
          {progress.full ? " (full backfill)" : ""}
        </div>
      )}
      {progress.completed && (
        <div className="mt-1 text-emerald-800">
          imported {progress.completed.imported} games in{" "}
          {(progress.completed.duration_ms / 1000).toFixed(1)}s
        </div>
      )}
      {progress.error && (
        <div className="mt-1 text-rose-800">{progress.error}</div>
      )}
    </div>
  );
}

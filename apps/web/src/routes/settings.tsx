import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  api,
  qk,
  type Me,
  type SearchResult,
  type SyncStatus,
} from "../lib/api.ts";
import { useSyncEvents } from "../lib/useSyncEvents.ts";
import { Spinner } from "../components/Spinner.tsx";
import { Button, Input } from "../components/ui/index.ts";

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

  const linking = linkMut.isPending;
  const backfilling = progress.active;

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-4">
          <div className="eyebrow-tight pb-4">The Desk</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 60,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Tools of
            <br />
            the trade.
          </h2>
          <hr className="rule-gold my-5" />
          <p className="marginalia">
            From this desk the proprietor binds the Almanac to{" "}
            <em>aoe4world</em> for automatic dispatches, and may instruct a
            fresh sync of the records.
          </p>
        </div>

        <div className="col-span-8 space-y-12">
          <div>
            <div className="flex items-center gap-4 pb-4">
              <span className="eyebrow">aoe4world Profile</span>
              <hr className="rule-faint flex-1" />
            </div>

            {me.data?.aoe4world_profile_id ? (
              <div className="space-y-4">
                <p className="font-display" style={{ fontSize: 22 }}>
                  Linked as{" "}
                  <span className="text-[#9b2b2b] font-semibold">
                    {me.data.display_name}
                  </span>{" "}
                  <span className="text-[#5b574e] italic">
                    (profile #{me.data.aoe4world_profile_id})
                  </span>
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="signet"
                    onClick={() => syncMut.mutate(false)}
                    disabled={syncMut.isPending || backfilling}
                  >
                    {(syncMut.isPending || backfilling) && (
                      <Spinner size={12} />
                    )}
                    Sync now
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => syncMut.mutate(true)}
                    disabled={syncMut.isPending || backfilling}
                  >
                    {(syncMut.isPending || backfilling) && (
                      <Spinner size={12} />
                    )}
                    Full backfill
                  </Button>
                  <Button
                    variant="warning"
                    onClick={() => unlinkMut.mutate()}
                    disabled={unlinkMut.isPending || backfilling}
                    className="ml-auto"
                  >
                    {unlinkMut.isPending && <Spinner size={12} />}
                    Unlink
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p
                  className="font-display italic text-[#5b574e]"
                  style={{ fontSize: 18, lineHeight: 1.4 }}
                >
                  Search for your in-game name to bind the Almanac to your
                  profile.
                </p>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <Input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && runSearch()}
                      placeholder="Your in-game name"
                      disabled={linking}
                    />
                  </div>
                  <Button
                    variant="signet"
                    onClick={runSearch}
                    disabled={query.length < 2 || searching || linking}
                  >
                    {searching && <Spinner size={12} />}
                    {searching ? "Searching…" : "Search"}
                  </Button>
                </div>
                {searchErr && (
                  <p className="kicker text-[#9b2b2b]">{searchErr}</p>
                )}
                {results.length > 0 && (
                  <ul className="divide-y divide-[rgba(28,28,26,0.1)] border-t border-b border-[rgba(28,28,26,0.18)]">
                    {results.map((p) => (
                      <li
                        key={p.profile_id}
                        className="flex items-center gap-4 py-3"
                      >
                        {p.avatar_url ? (
                          <img
                            src={p.avatar_url}
                            alt=""
                            className="size-10"
                          />
                        ) : (
                          <div className="size-10 bg-[#ddd5c4]" />
                        )}
                        <div className="flex-1">
                          <p
                            className="font-display"
                            style={{ fontSize: 19, fontWeight: 600 }}
                          >
                            {p.name}
                          </p>
                          <p className="kicker" style={{ fontSize: 12 }}>
                            {p.country?.toUpperCase() ?? "—"} · last game:{" "}
                            {p.last_game_at
                              ? new Date(p.last_game_at).toLocaleDateString()
                              : "—"}
                          </p>
                        </div>
                        <Button
                          variant="signet"
                          size="sm"
                          onClick={() => linkMut.mutate(p.profile_id)}
                          disabled={linkMut.isPending}
                        >
                          {linkMut.isPending &&
                            linkMut.variables === p.profile_id && (
                              <Spinner size={12} />
                            )}
                          Link
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-4 pb-4">
              <span className="eyebrow">Sync Status</span>
              <hr className="rule-faint flex-1" />
            </div>

            {(linking || backfilling || progress.completed || progress.error) && (
              <SyncProgressPanel progress={progress} linking={linking} />
            )}

            {sync.data?.rows.length === 0 ? (
              <p className="kicker">No sync yet.</p>
            ) : (
              <div className="space-y-4">
                {sync.data?.rows.map((r) => (
                  <div
                    key={r.leaderboard}
                    className="border-l-2 border-[rgba(28,28,26,0.18)] pl-4"
                  >
                    <p
                      className="font-display"
                      style={{ fontSize: 19, fontWeight: 600 }}
                    >
                      {r.leaderboard}
                    </p>
                    <dl className="stat-block pt-2">
                      <dt>Last game</dt>
                      <dd>{r.last_seen_game_id ?? "—"}</dd>
                      <dt>Polled</dt>
                      <dd className="italic">{fmtDate(r.last_polled_at)}</dd>
                      <dt>Success</dt>
                      <dd className="italic">{fmtDate(r.last_success_at)}</dd>
                    </dl>
                    {r.last_error && (
                      <p className="kicker pt-2 text-[#9b2b2b]">
                        Error: {r.last_error}
                      </p>
                    )}
                  </div>
                ))}
                <p className="kicker">
                  {sync.data?.in_flight ? "Sync running…" : "Idle."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
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
    ? "border-[#9b2b2b] bg-[rgba(155,43,43,0.06)]"
    : progress.completed
      ? "border-[#7a6a4a] bg-[rgba(122,106,74,0.08)]"
      : "border-[#9b2b2b] bg-[rgba(155,43,43,0.04)]";

  return (
    <div className={`mb-4 border-l-2 ${accent} pl-4 py-3`}>
      <div
        className="flex items-center gap-3 font-display"
        style={{ fontSize: 18, fontWeight: 600 }}
      >
        {(progress.active || linking) && <Spinner size={12} />}
        <span>{status}</span>
        {progress.display_name && (
          <span className="kicker italic">· {progress.display_name}</span>
        )}
      </div>
      {(progress.active || progress.page > 0) && (
        <p className="kicker pt-1">
          page {progress.page} · {progress.imported_so_far} new game
          {progress.imported_so_far === 1 ? "" : "s"} imported
          {progress.full ? " (full backfill)" : ""}
        </p>
      )}
      {progress.completed && (
        <p className="kicker pt-1">
          imported {progress.completed.imported} games in{" "}
          {(progress.completed.duration_ms / 1000).toFixed(1)}s
        </p>
      )}
      {progress.error && (
        <p className="kicker pt-1 text-[#9b2b2b]">{progress.error}</p>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  api,
  clearGameDataCache,
  invalidateGameDataCache,
  qk,
  type DataCounts,
  type Me,
  type SearchResult,
  type SyncStatus,
} from "../lib/api.ts";
import { useSyncEvents } from "../lib/useSyncEvents.ts";
import { Spinner } from "../components/Spinner.tsx";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "../components/ui/index.ts";

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
      invalidateGameDataCache(qc);
    }
  }, [progress.last_event, qc]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const linkMut = useMutation({
    mutationFn: (profile_id: number) =>
      api.post<{ ok: true }>("/me/link-aoe4world", { profile_id }),
    onSuccess: () => {
      // Wipe any cached data from a prior linked profile (or from the unlinked
      // state) before the backfill begins repopulating it.
      clearGameDataCache(qc);
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });

  const unlinkMut = useMutation({
    mutationFn: () => api.delete<{ ok: true }>("/me/link-aoe4world"),
    onSuccess: () => {
      // Data is gone server-side — drop it from the cache rather than refetch
      // (queries gated on `linked` won't refetch anyway, but old cached
      // values shouldn't linger if the user re-links to a different profile).
      clearGameDataCache(qc);
      void qc.invalidateQueries({ queryKey: qk.me });
    },
  });

  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const dataCounts = useQuery({
    queryKey: qk.dataCounts,
    queryFn: () => api.get<DataCounts>("/me/data-counts"),
    enabled: !!me.data?.aoe4world_profile_id,
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
                    onClick={() => setUnlinkOpen(true)}
                    disabled={unlinkMut.isPending || backfilling}
                    className="ml-auto"
                  >
                    {unlinkMut.isPending && <Spinner size={12} />}
                    Unlink
                  </Button>
                </div>
                <p className="kicker italic text-[#5b574e]">
                  Unlinking permanently deletes all imported games and sync
                  history. Your civ, matchup, and map notes are preserved.
                </p>
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
                          onClick={() => {
                            linkMut.mutate(p.profile_id);
                            setResults([]);
                            setQuery("");
                          }}
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

      <UnlinkConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        counts={dataCounts.data}
        displayName={me.data?.display_name ?? null}
        profileId={me.data?.aoe4world_profile_id ?? null}
        pending={unlinkMut.isPending}
        onConfirm={() => {
          unlinkMut.mutate(undefined, {
            onSuccess: () => setUnlinkOpen(false),
          });
        }}
      />
    </section>
  );
}

function UnlinkConfirmDialog({
  open,
  onOpenChange,
  counts,
  displayName,
  profileId,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: DataCounts | undefined;
  displayName: string | null;
  profileId: number | null;
  pending: boolean;
  onConfirm: () => void;
}) {
  const games = counts?.games ?? 0;
  const gameNotes = counts?.game_notes ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sever the binding?</DialogTitle>
          <DialogDescription>
            You are about to unlink{" "}
            <span className="font-semibold text-[#9b2b2b]">
              {displayName ?? "this profile"}
            </span>
            {profileId !== null && (
              <span className="italic text-[#5b574e]">
                {" "}
                (profile #{profileId})
              </span>
            )}
            . This permanently deletes imported games and sync history from
            the Almanac. The deletion cannot be undone from here — you would
            need to re-link and run a full backfill.
          </DialogDescription>
        </DialogHeader>

        <div className="border-l-2 border-[#9b2b2b] bg-[rgba(155,43,43,0.05)] px-4 py-3">
          <p
            className="eyebrow-tight pb-2"
            style={{ color: "#7a1f1f" }}
          >
            Will be deleted
          </p>
          <dl className="stat-block">
            <dt>Imported games</dt>
            <dd className="font-display font-semibold">{games}</dd>
            <dt>Game-specific notes</dt>
            <dd className="font-display font-semibold">{gameNotes}</dd>
            <dt>Sync history</dt>
            <dd className="font-display font-semibold">
              {counts?.sync_state_rows ?? 0} row
              {counts?.sync_state_rows === 1 ? "" : "s"}
            </dd>
          </dl>
          <p className="kicker pt-3 italic text-[#5b574e]">
            Civ, matchup, and map notes are kept — they belong to you, not the
            profile.
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="warning"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Spinner size={12} />}
            Unlink &amp; delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmtSeconds(s: number): string {
  if (!isFinite(s) || s < 0) return "—";
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
}

function SyncProgressPanel({
  progress,
  linking,
}: {
  progress: ReturnType<typeof useSyncEvents>;
  linking: boolean;
}) {
  // Tick once a second while active so elapsed/ETA strings stay fresh between
  // sync.page events.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!progress.active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [progress.active]);

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

  // Show a % only on full backfills — incremental syncs reuse aoe4world's
  // all-time total_count as the denominator, which would mislead.
  const showPercent =
    progress.active &&
    progress.full &&
    progress.total_count !== null &&
    progress.total_count > 0;
  const pct = showPercent
    ? Math.min(100, Math.round((progress.scanned_so_far / (progress.total_count ?? 1)) * 100))
    : null;

  const elapsedMs =
    progress.active && progress.started_at !== null
      ? Date.now() - progress.started_at
      : null;
  const etaSeconds =
    showPercent &&
    elapsedMs !== null &&
    progress.scanned_so_far > 0 &&
    progress.total_count !== null
      ? ((elapsedMs / 1000) * (progress.total_count - progress.scanned_so_far)) /
        progress.scanned_so_far
      : null;

  return (
    <div className={`mb-4 border-l-2 ${accent} px-4 py-3`}>
      <div
        className="flex items-center gap-3 font-display"
        style={{ fontSize: 18, fontWeight: 600 }}
      >
        {(progress.active || linking) && <Spinner size={12} />}
        <span>{status}</span>
        {progress.display_name && (
          <span className="kicker italic">· {progress.display_name}</span>
        )}
        {pct !== null && (
          <span className="ml-auto font-display tabular-nums" style={{ fontSize: 18 }}>
            {pct}%
          </span>
        )}
      </div>

      {showPercent && (
        <div
          className="mt-2 h-1.5 bg-[rgba(28,28,26,0.1)] overflow-hidden"
          role="progressbar"
          aria-valuenow={pct ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-[#9b2b2b] transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {progress.active && progress.full && !showPercent && (
        <div className="mt-2 h-1.5 bg-[rgba(28,28,26,0.1)] overflow-hidden">
          <div className="h-full w-1/3 bg-[#9b2b2b] animate-pulse" />
        </div>
      )}

      {(progress.active || progress.page > 0) && (
        <p className="kicker pt-1">
          page {progress.page} ·{" "}
          {progress.full && progress.total_count !== null ? (
            <>
              {progress.scanned_so_far} of {progress.total_count} scanned ·{" "}
            </>
          ) : null}
          {progress.imported_so_far} new game
          {progress.imported_so_far === 1 ? "" : "s"} imported
          {progress.full ? " (full backfill)" : ""}
        </p>
      )}

      {progress.active && elapsedMs !== null && (
        <p className="kicker pt-0.5 flex items-baseline gap-3">
          <span>{fmtSeconds(elapsedMs / 1000)} elapsed</span>
          {etaSeconds !== null && (
            <span className="italic text-[#5b574e]">
              · ~{fmtSeconds(etaSeconds)} remaining
            </span>
          )}
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

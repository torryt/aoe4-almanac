import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { prettyCivName } from "@aoe4-almanac/shared";
import {
  api,
  qk,
  type Civ,
  type GameDto,
  type GameNoteBatchEntry,
} from "../lib/api.ts";
import { Spinner } from "../components/Spinner.tsx";
import { prettyMap } from "./index.tsx";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../components/ui/index.ts";
import ReactMarkdown from "react-markdown";

export const Route = createFileRoute("/notes/matchups/$myCiv/$oppCiv")({
  component: MatchupNoteEditor,
});

function fmtDay(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })}`;
}

function MatchupNoteEditor() {
  const { myCiv, oppCiv } = Route.useParams();
  const qc = useQueryClient();

  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const noteQ = useQuery({
    queryKey: qk.matchupNote(myCiv, oppCiv),
    queryFn: () =>
      api.get<{ body_md: string; updated_at: number | null }>(
        `/notes/matchups/${myCiv}/${oppCiv}`,
      ),
  });
  const statsQ = useQuery({
    queryKey: qk.statsByCiv(myCiv),
    queryFn: () =>
      api.get<{
        rows: Array<{
          opp_civ_slug: string;
          games: number;
          wins: number;
          losses: number;
          win_rate: number | null;
        }>;
      }>(`/stats/by-civ?my_civ=${myCiv}`),
  });
  const PAGE_SIZE = 10;
  const gamesQ = useInfiniteQuery({
    queryKey: qk.games({ civ: myCiv, opp_civ: oppCiv, limit: PAGE_SIZE, paged: true }),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        civ: myCiv,
        opp_civ: oppCiv,
        limit: String(PAGE_SIZE),
      });
      if (pageParam !== null) qs.set("cursor", String(pageParam));
      return api.get<{ games: GameDto[]; next_cursor: number | null }>(
        `/games?${qs.toString()}`,
      );
    },
    getNextPageParam: (last) => last.next_cursor,
  });
  const allGames = gamesQ.data?.pages.flatMap((p) => p.games) ?? [];
  const gameIds = allGames.map((g) => g.id);

  const gameNotesQ = useQuery({
    queryKey: qk.gameNotesBatch(gameIds),
    queryFn: () =>
      api.get<{ notes: GameNoteBatchEntry[] }>(
        `/notes/games?ids=${gameIds.join(",")}`,
      ),
    enabled: gameIds.length > 0,
  });
  const gameNotesById = new Map<number, GameNoteBatchEntry>();
  for (const n of gameNotesQ.data?.notes ?? []) gameNotesById.set(n.game_id, n);

  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(noteQ.data?.body_md ?? "");
  }, [noteQ.data?.body_md]);

  const save = useMutation({
    mutationFn: (body_md: string) =>
      api.put<{ ok: true }>(`/notes/matchups/${myCiv}/${oppCiv}`, { body_md }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.matchupNote(myCiv, oppCiv) });
      qc.invalidateQueries({ queryKey: qk.matchupNotes() });
    },
  });

  const civsMap = new Map((civsQ.data?.civs ?? []).map((c) => [c.slug, c]));
  const my = civsMap.get(myCiv);
  const opp = civsMap.get(oppCiv);
  const stats = (statsQ.data?.rows ?? []).find((r) => r.opp_civ_slug === oppCiv);
  const games = allGames;

  const wordCount = draft.trim().split(/\s+/).filter(Boolean).length;
  const dirty = draft !== (noteQ.data?.body_md ?? "");

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="flex items-center gap-4 pb-6">
        <span className="eyebrow">The Feature</span>
        <hr className="rule-faint flex-1" />
        <span className="eyebrow">A study in one matchup</span>
      </div>

      <div className="grid grid-cols-12 gap-10">
        <article className="col-span-8">
          <Link to="/notes/matchups" className="nav-link inline-block mb-4">
            ← Matchup Table
          </Link>
          <p className="kicker pb-2">An essay on a familiar opponent.</p>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 88,
              lineHeight: 0.92,
              fontWeight: 700,
              letterSpacing: "-0.025em",
            }}
          >
            {my?.name ?? prettyCivName(myCiv)}
            <br />
            <span
              className="font-display italic text-[#5b574e]"
              style={{ fontWeight: 500 }}
            >
              versus
            </span>{" "}
            {opp?.name ?? prettyCivName(oppCiv)}.
          </h2>

          {stats && (
            <p
              className="font-display italic pt-5 text-[#5b574e]"
              style={{ fontSize: 22, lineHeight: 1.4, maxWidth: "60ch" }}
            >
              {stats.games} game{stats.games === 1 ? "" : "s"} on record.{" "}
              {stats.win_rate !== null && (
                <span className="text-[#9b2b2b]">
                  {(stats.win_rate * 100).toFixed(1)} percent
                </span>
              )}{" "}
              {stats.win_rate !== null && "won."}
            </p>
          )}

          <hr className="rule mt-8" />

          <Tabs defaultValue="write" className="pt-8">
            <div className="flex items-center justify-between pb-3">
              <div className="eyebrow-tight">The note</div>
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="read">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="write">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="essay dropcap"
                placeholder={`${my?.name ?? prettyCivName(myCiv)} vs ${opp?.name ?? prettyCivName(oppCiv)}: what to do, when, common opener responses…`}
              />
            </TabsContent>
            <TabsContent value="read">
              <div className="prose-note">
                {draft.trim() ? (
                  <ReactMarkdown>{draft}</ReactMarkdown>
                ) : (
                  <span className="kicker">Nothing written yet.</span>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <hr className="rule-faint mt-6" />
          <div className="flex items-center justify-between pt-3">
            <span className="kicker" style={{ fontSize: 13 }}>
              {noteQ.data?.updated_at
                ? `Last revised ${relative(noteQ.data.updated_at)}`
                : "Unwritten"}{" "}
              · {wordCount} word{wordCount === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-3">
              <span className="folio">page 9</span>
              <Button
                variant="signet"
                size="sm"
                onClick={() => save.mutate(draft)}
                disabled={!dirty || save.isPending}
              >
                {save.isPending ? "Saving…" : dirty ? "Save Essay" : "Saved"}
              </Button>
            </div>
          </div>

          <MatchupGames
            games={games}
            notesById={gameNotesById}
            isLoading={gamesQ.isLoading}
            hasNextPage={gamesQ.hasNextPage ?? false}
            isFetchingNextPage={gamesQ.isFetchingNextPage}
            onLoadMore={() => void gamesQ.fetchNextPage()}
          />
        </article>

        <aside className="col-span-4 border-l border-[rgba(28,28,26,0.15)] pl-8">
          <div className="eyebrow-tight pb-4">In figures</div>
          {stats ? (
            <dl className="stat-block">
              <dt>Games</dt>
              <dd>{stats.games}</dd>
              <dt>Won</dt>
              <dd>{stats.wins}</dd>
              <dt>Lost</dt>
              <dd className="text-[#9b2b2b]">{stats.losses}</dd>
              <dt>Win rate</dt>
              <dd>
                {stats.win_rate !== null
                  ? `${(stats.win_rate * 100).toFixed(1)}%`
                  : "—"}
              </dd>
            </dl>
          ) : (
            <p className="kicker">No games recorded yet.</p>
          )}

          <hr className="rule-faint my-6" />

          <div className="eyebrow-tight pb-3">Cross-references</div>
          <p
            className="font-display italic"
            style={{ fontSize: 14, lineHeight: 1.7, color: "#5b574e" }}
          >
            See also:{" "}
            <Link
              to="/notes/civs/$slug"
              params={{ slug: myCiv }}
              className="not-italic text-[#1c1c1a] hover:underline"
            >
              {my?.name ?? prettyCivName(myCiv)} general
            </Link>{" "}
            ·{" "}
            <Link
              to="/notes/matchups/$myCiv/$oppCiv"
              params={{ myCiv: oppCiv, oppCiv: myCiv }}
              className="not-italic text-[#1c1c1a] hover:underline"
            >
              reverse: {opp?.name ?? prettyCivName(oppCiv)} → {my?.name ?? prettyCivName(myCiv)}
            </Link>
          </p>
        </aside>
      </div>
    </section>
  );
}

function MatchupGames({
  games,
  notesById,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: {
  games: GameDto[];
  notesById: Map<number, GameNoteBatchEntry>;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  const annotated = games.filter((g) => {
    const n = notesById.get(g.id);
    return n && n.body_md.trim().length > 0;
  }).length;

  return (
    <section className="pt-12">
      <div className="flex items-center gap-4 pb-4">
        <span className="eyebrow">From the field</span>
        <hr className="rule-faint flex-1" />
        <span className="eyebrow">
          {games.length} game{games.length === 1 ? "" : "s"} · {annotated} noted
        </span>
      </div>

      {isLoading ? (
        <p className="kicker py-6 flex items-center gap-2">
          <Spinner size={12} /> Loading prior encounters…
        </p>
      ) : games.length === 0 ? (
        <p className="kicker py-6 italic">
          No prior meetings on record.
        </p>
      ) : (
        <div className="space-y-6">
          {games.map((g) => {
            const note = notesById.get(g.id);
            const hasNote = note && note.body_md.trim().length > 0;
            const opp = g.participants.find((p) => !p.is_self);
            return (
              <article
                key={g.id}
                className={`pl-5 border-l-2 ${hasNote ? "border-[#7a6a4a]" : "border-[rgba(28,28,26,0.15)]"}`}
              >
                <div className="flex items-baseline justify-between pb-2 gap-4">
                  <Link
                    to="/games/$gameId"
                    params={{ gameId: String(g.id) }}
                    className="font-display hover:underline"
                    style={{ fontSize: 20, fontWeight: 600 }}
                  >
                    {fmtDay(g.started_at)}{" "}
                    <span className="text-[#5b574e] italic font-normal">on</span>{" "}
                    <span className="italic">
                      {g.map_slug ? prettyMap(g.map_slug) : "—"}
                    </span>
                  </Link>
                  <div className="font-display" style={{ fontSize: 15 }}>
                    <span
                      className={
                        g.my_result === "win"
                          ? "result-W"
                          : g.my_result === "loss"
                            ? "result-L"
                            : ""
                      }
                    >
                      {g.my_result === "win"
                        ? "Victory"
                        : g.my_result === "loss"
                          ? "Defeat"
                          : g.my_result === "draw"
                            ? "Draw"
                            : "—"}
                    </span>
                    {opp && (
                      <span className="text-[#5b574e] italic">
                        {" "}
                        · vs {opp.name}
                      </span>
                    )}
                    {g.my_rating_diff !== null && (
                      <span
                        className={g.my_rating_diff < 0 ? "text-[#9b2b2b]" : ""}
                      >
                        {" "}
                        ·{" "}
                        {g.my_rating_diff > 0
                          ? `+${g.my_rating_diff}`
                          : g.my_rating_diff < 0
                            ? `−${Math.abs(g.my_rating_diff)}`
                            : "0"}
                      </span>
                    )}
                  </div>
                </div>
                {hasNote ? (
                  <>
                    <div className="prose-note">
                      <ReactMarkdown>{note!.body_md}</ReactMarkdown>
                    </div>
                    {note?.updated_at && (
                      <p className="kicker pt-2" style={{ fontSize: 12 }}>
                        Recorded {relative(note.updated_at)}.
                      </p>
                    )}
                  </>
                ) : (
                  <p
                    className="font-display italic text-[#5b574e]"
                    style={{ fontSize: 14 }}
                  >
                    <Link
                      to="/games/$gameId"
                      params={{ gameId: String(g.id) }}
                      className="hover:underline"
                    >
                      No note on file — open the dossier →
                    </Link>
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-6">
        <span className="kicker italic">
          {games.length > 0 && (
            <>
              Showing {games.length} game{games.length === 1 ? "" : "s"}
              {hasNextPage ? " · more on file" : " · end of record"}
            </>
          )}
        </span>
        {hasNextPage && (
          <Button
            variant="ghost"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage && <Spinner size={12} />}
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        )}
      </div>
    </section>
  );
}

function relative(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

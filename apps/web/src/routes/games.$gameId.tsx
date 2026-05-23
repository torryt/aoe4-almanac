import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api, qk, type Civ, type GameDto } from "../lib/api.ts";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../components/ui/index.ts";
import { prettyCiv, prettyMap } from "./index.tsx";

export const Route = createFileRoute("/games/$gameId")({
  component: GameDetail,
});

type GameDetailDto = GameDto & {
  map_slug: string | null;
  duration_seconds: number | null;
  raw_payload: unknown;
};

function fmtDate(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })}`;
}

function fmtDuration(s: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function GameDetail() {
  const { gameId } = Route.useParams();
  const id = Number(gameId);
  const qc = useQueryClient();

  const gameQ = useQuery({
    queryKey: qk.game(id),
    queryFn: () => api.get<GameDetailDto>(`/games/${id}`),
  });
  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const noteQ = useQuery({
    queryKey: qk.gameNote(id),
    queryFn: () =>
      api.get<{ body_md: string; updated_at: number | null }>(
        `/notes/games/${id}`,
      ),
  });

  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(noteQ.data?.body_md ?? "");
  }, [noteQ.data?.body_md]);

  const saveNote = useMutation({
    mutationFn: (body_md: string) =>
      api.put<{ ok: true }>(`/notes/games/${id}`, { body_md }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.gameNote(id) }),
  });

  if (gameQ.isLoading)
    return (
      <section className="spread px-10 pt-16 pb-20">
        <p className="kicker">Loading the match…</p>
      </section>
    );
  if (gameQ.isError || !gameQ.data)
    return (
      <section className="spread px-10 pt-16 pb-20">
        <p className="kicker text-[#9b2b2b]">Match not found.</p>
      </section>
    );

  const g = gameQ.data;
  const civMap = new Map((civsQ.data?.civs ?? []).map((c) => [c.slug, c]));
  const oppParts = g.participants.filter((p) => !p.is_self);
  const selfPart = g.participants.find((p) => p.is_self);
  const dirty = draft !== (noteQ.data?.body_md ?? "");

  return (
    <section className="spread px-10 pt-16 pb-24">
      <Link to="/games" className="nav-link inline-block mb-4">
        ← The Ledger
      </Link>
      <div className="flex items-center gap-4 pb-6">
        <span className="eyebrow">The Single Match</span>
        <hr className="rule-faint flex-1" />
        <span className="eyebrow">Match no. {g.id}</span>
      </div>

      <div className="grid grid-cols-12 gap-10">
        <article className="col-span-8">
          <p className="kicker pb-2">From the desk of the proprietor.</p>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 60,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            {fmtDate(g.started_at)}{" "}
            <span
              className="font-display italic text-[#5b574e]"
              style={{ fontWeight: 500 }}
            >
              ·
            </span>{" "}
            <span className="text-[#9b2b2b]">{prettyCiv(g.my_civ_slug)}</span>{" "}
            <span
              className="font-display italic text-[#5b574e]"
              style={{ fontWeight: 500 }}
            >
              vs
            </span>{" "}
            {oppParts[0]
              ? prettyCiv(oppParts[0].civ_slug)
              : "—"}
            {g.map_slug && (
              <>
                {" "}
                <span
                  className="font-display italic text-[#5b574e]"
                  style={{ fontWeight: 500 }}
                >
                  on
                </span>{" "}
                {prettyMap(g.map_slug)}
              </>
            )}
            .
          </h2>

          <p
            className="font-display italic pt-5 text-[#5b574e]"
            style={{ fontSize: 20, lineHeight: 1.4 }}
          >
            {g.my_result === "win" && "A victory"}
            {g.my_result === "loss" && "A defeat"}
            {g.my_result === "draw" && "A draw"}
            {g.my_result !== "win" && g.my_result !== "loss" && g.my_result !== "draw" && "A campaign"}
            {g.duration_seconds && ` in ${fmtDuration(g.duration_seconds)}`}
            {g.my_rating_diff !== null && (
              <>
                {" — "}
                <span
                  className={g.my_rating_diff < 0 ? "text-[#9b2b2b]" : ""}
                >
                  {g.my_rating_diff > 0
                    ? `+${g.my_rating_diff}`
                    : g.my_rating_diff < 0
                      ? `−${Math.abs(g.my_rating_diff)}`
                      : "0"}{" "}
                  to the rating
                </span>
              </>
            )}
            .
          </p>

          <hr className="rule mt-8" />

          <div className="grid grid-cols-2 gap-12 pt-6">
            <div>
              <div className="eyebrow-tight pb-3">In the red</div>
              <p
                className="font-display"
                style={{ fontSize: 22, fontWeight: 600 }}
              >
                {selfPart?.name ?? "the proprietor"}
              </p>
              <dl className="stat-block pt-3">
                <dt>Civ</dt>
                <dd className="text-[#9b2b2b]">
                  {prettyCiv(g.my_civ_slug)}
                  {civMap.get(g.my_civ_slug)?.is_variant && (
                    <span
                      className="italic ml-1"
                      style={{ fontSize: 12, color: "#5b574e" }}
                    >
                      (variant)
                    </span>
                  )}
                </dd>
                <dt>Result</dt>
                <dd>
                  {g.my_result === "win"
                    ? "Victory"
                    : g.my_result === "loss"
                      ? "Defeat"
                      : g.my_result}
                </dd>
                <dt>Rating</dt>
                <dd>
                  {g.my_rating ?? "—"}
                  {g.my_rating_diff !== null && g.my_rating_diff !== 0 && (
                    <span className="text-[#5b574e] italic">
                      {" "}
                      ({g.my_rating_diff > 0 ? "+" : ""}
                      {g.my_rating_diff})
                    </span>
                  )}
                </dd>
              </dl>
            </div>
            {oppParts.length > 0 && (
              <div>
                <div className="eyebrow-tight pb-3">In the field</div>
                <p
                  className="font-display"
                  style={{ fontSize: 22, fontWeight: 600 }}
                >
                  {oppParts[0]?.name ?? "Opponent"}
                </p>
                <dl className="stat-block pt-3">
                  <dt>Civ</dt>
                  <dd>
                    {prettyCiv(oppParts[0]?.civ_slug ?? "")}
                  </dd>
                  <dt>Result</dt>
                  <dd>
                    {oppParts[0]?.result === "win"
                      ? "Victory"
                      : oppParts[0]?.result === "loss"
                        ? "Defeat"
                        : oppParts[0]?.result ?? "—"}
                  </dd>
                  <dt>Rating</dt>
                  <dd>
                    {oppParts[0]?.rating ?? "—"}
                    {oppParts[0]?.rating_diff !== null &&
                      oppParts[0]?.rating_diff !== undefined && (
                        <span className="text-[#5b574e] italic">
                          {" "}
                          ({oppParts[0].rating_diff > 0 ? "+" : ""}
                          {oppParts[0].rating_diff})
                        </span>
                      )}
                  </dd>
                </dl>
              </div>
            )}
          </div>

          {g.participants.length > 2 && (
            <>
              <hr className="rule mt-8" />
              <div className="pt-6">
                <div className="eyebrow-tight pb-3">All participants</div>
                <table className="w-full font-display" style={{ fontSize: 15 }}>
                  <thead>
                    <tr className="border-b border-[rgba(28,28,26,0.18)]">
                      <th className="eyebrow-tight text-left py-2">Team</th>
                      <th className="eyebrow-tight text-left py-2">Player</th>
                      <th className="eyebrow-tight text-left py-2">Civ</th>
                      <th className="eyebrow-tight text-left py-2">Result</th>
                      <th className="eyebrow-tight text-right py-2">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.participants.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-[rgba(28,28,26,0.08)]"
                      >
                        <td className="py-2">{p.team + 1}</td>
                        <td className="py-2">
                          {p.is_self ? (
                            <span className="text-[#9b2b2b] font-semibold">
                              {p.name}
                            </span>
                          ) : (
                            p.name
                          )}
                        </td>
                        <td className="py-2 italic">
                          {prettyCiv(p.civ_slug)}
                        </td>
                        <td
                          className={`py-2 ${p.result === "win" ? "result-W" : p.result === "loss" ? "result-L" : ""}`}
                        >
                          {p.result === "win"
                            ? "W"
                            : p.result === "loss"
                              ? "L"
                              : "—"}
                        </td>
                        <td className="py-2 text-right">{p.rating ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <hr className="rule mt-8" />

          <Tabs defaultValue="write" className="pt-8">
            <div className="flex items-center justify-between pb-3">
              <div className="eyebrow-tight">Notes on the day</div>
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="read">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="write">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                className="essay"
                placeholder="Build, key timings, lessons learned…"
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

          <hr className="rule-faint mt-8" />
          <div className="flex items-center justify-between pt-4">
            <div className="flex items-baseline gap-6">
              <span className="eyebrow-tight">Kind: {g.kind}</span>
              {g.leaderboard && (
                <span className="eyebrow-tight">{g.leaderboard}</span>
              )}
              {g.my_rating_diff !== null && (
                <span className="eyebrow-tight">
                  Δ MMR{" "}
                  {g.my_rating_diff > 0
                    ? `+${g.my_rating_diff}`
                    : g.my_rating_diff}
                </span>
              )}
              {g.duration_seconds && (
                <span className="eyebrow-tight">
                  Length {fmtDuration(g.duration_seconds)}
                </span>
              )}
            </div>
            <Button
              variant="signet"
              size="sm"
              onClick={() => saveNote.mutate(draft)}
              disabled={!dirty || saveNote.isPending}
            >
              {saveNote.isPending ? "Saving…" : dirty ? "Save Note" : "Saved"}
            </Button>
          </div>
        </article>

        <aside className="col-span-4 border-l border-[rgba(28,28,26,0.15)] pl-8">
          <div className="eyebrow-tight pb-3">The setting</div>
          <p className="marginalia pb-5">
            {g.kind === "rm_1v1"
              ? "A ranked 1v1 campaign."
              : g.kind === "manual"
                ? "A manual record, logged by hand."
                : `A ${g.kind.replace(/_/g, " ")} match.`}
            {g.map_slug && ` Fought on ${prettyMap(g.map_slug)}.`}
          </p>

          <hr className="rule-faint my-5" />

          <div className="eyebrow-tight pb-3">In figures</div>
          <dl className="stat-block">
            <dt>Date</dt>
            <dd>{fmtDate(g.started_at)}</dd>
            <dt>Length</dt>
            <dd>{fmtDuration(g.duration_seconds)}</dd>
            <dt>Kind</dt>
            <dd>{g.kind}</dd>
            {g.leaderboard && (
              <>
                <dt>Board</dt>
                <dd>{g.leaderboard}</dd>
              </>
            )}
            <dt>Source</dt>
            <dd className="italic">{g.source}</dd>
          </dl>

          {g.aoe4world_game_id && (
            <>
              <hr className="rule-faint my-5" />
              <a
                href={`https://aoe4world.com/players/games/${g.aoe4world_game_id}`}
                target="_blank"
                rel="noreferrer"
                className="nav-link"
              >
                View on aoe4world ↗
              </a>
            </>
          )}

          <hr className="rule-faint my-5" />

          <div className="eyebrow-tight pb-3">Cross-references</div>
          <p
            className="font-display italic"
            style={{ fontSize: 14, lineHeight: 1.7, color: "#5b574e" }}
          >
            See also:{" "}
            <Link
              to="/notes/civs/$slug"
              params={{ slug: g.my_civ_slug }}
              className="not-italic text-[#1c1c1a] hover:underline"
            >
              {prettyCiv(g.my_civ_slug)} general
            </Link>
            {oppParts[0] && (
              <>
                {" "}
                ·{" "}
                <Link
                  to="/notes/matchups/$myCiv/$oppCiv"
                  params={{
                    myCiv: g.my_civ_slug,
                    oppCiv: oppParts[0].civ_slug,
                  }}
                  className="not-italic text-[#1c1c1a] hover:underline"
                >
                  matchup essay
                </Link>
              </>
            )}
            {g.map_slug && (
              <>
                {" "}
                ·{" "}
                <Link
                  to="/notes/maps/$slug"
                  params={{ slug: g.map_slug }}
                  className="not-italic text-[#1c1c1a] hover:underline"
                >
                  map note
                </Link>
              </>
            )}
          </p>
        </aside>
      </div>
    </section>
  );
}

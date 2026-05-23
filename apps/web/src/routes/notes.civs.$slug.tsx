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
import { prettyCiv } from "./index.tsx";

export const Route = createFileRoute("/notes/civs/$slug")({
  component: CivNoteEditor,
});

function CivNoteEditor() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();

  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const noteQ = useQuery({
    queryKey: qk.civNote(slug),
    queryFn: () =>
      api.get<{ body_md: string; updated_at: number | null }>(
        `/notes/civs/${slug}`,
      ),
  });
  const statsQ = useQuery({
    queryKey: qk.statsByCiv(slug),
    queryFn: () =>
      api.get<{
        rows: Array<{
          opp_civ_slug: string;
          games: number;
          wins: number;
          losses: number;
          win_rate: number | null;
        }>;
      }>(`/stats/by-civ?my_civ=${slug}`),
  });
  const recentQ = useQuery({
    queryKey: qk.games({ civ: slug, limit: 5 }),
    queryFn: () => api.get<{ games: GameDto[] }>(`/games?civ=${slug}&limit=5`),
  });

  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(noteQ.data?.body_md ?? "");
  }, [noteQ.data?.body_md]);

  const save = useMutation({
    mutationFn: (body_md: string) =>
      api.put<{ ok: true }>(`/notes/civs/${slug}`, { body_md }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.civNote(slug) });
      qc.invalidateQueries({ queryKey: qk.civNotes });
    },
  });

  const civ = (civsQ.data?.civs ?? []).find((c) => c.slug === slug);
  const civName = civ?.name ?? slug;
  const parent = civ?.parent_slug
    ? (civsQ.data?.civs ?? []).find((c) => c.slug === civ.parent_slug)
    : undefined;
  const variants = (civsQ.data?.civs ?? []).filter(
    (c) => c.parent_slug === slug,
  );

  const totals = (statsQ.data?.rows ?? []).reduce(
    (acc, r) => {
      acc.games += r.games;
      acc.wins += r.wins;
      acc.losses += r.losses;
      return acc;
    },
    { games: 0, wins: 0, losses: 0 },
  );
  const dirty = draft !== (noteQ.data?.body_md ?? "");

  return (
    <section className="spread px-10 pt-16 pb-20">
      <Link to="/notes/civs" className="nav-link inline-block mb-4">
        ← The Roster
      </Link>
      <div className="flex items-center gap-4 pb-6">
        <span className="eyebrow">The Standing Note</span>
        <hr className="rule-faint flex-1" />
        <span className="eyebrow">{civ?.is_variant ? "Variant" : "Civilization"}</span>
      </div>

      <div className="grid grid-cols-12 gap-10">
        <article className="col-span-8">
          <p className="kicker pb-2">A general study.</p>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 80,
              lineHeight: 0.92,
              fontWeight: 700,
              letterSpacing: "-0.025em",
            }}
          >
            <span className="text-[#9b2b2b]">{civName}</span>.
          </h2>

          {civ?.is_variant && parent && (
            <p
              className="font-display italic pt-4 text-[#5b574e]"
              style={{ fontSize: 18 }}
            >
              A variant of{" "}
              <Link
                to="/notes/civs/$slug"
                params={{ slug: parent.slug }}
                className="not-italic text-[#1c1c1a] hover:underline"
              >
                {parent.name}
              </Link>
              .
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
                placeholder={`Opening preferences, economic rhythm, signature units for ${civName}…`}
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
                : "Unwritten"}
            </span>
            <Button
              variant="signet"
              size="sm"
              onClick={() => save.mutate(draft)}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : dirty ? "Save Note" : "Saved"}
            </Button>
          </div>
        </article>

        <aside className="col-span-4 border-l border-[rgba(28,28,26,0.15)] pl-8">
          <div className="eyebrow-tight pb-4">My {civName} record</div>
          {totals.games === 0 ? (
            <p className="kicker">No games yet.</p>
          ) : (
            <>
              <div
                className="font-display"
                style={{ fontSize: 56, lineHeight: 1, fontWeight: 700 }}
              >
                {totals.wins}
                <span className="text-[#5b574e] italic font-normal">–</span>
                {totals.losses}
              </div>
              <p className="kicker pt-2">
                {((totals.wins / totals.games) * 100).toFixed(1)}% across{" "}
                {totals.games} game{totals.games === 1 ? "" : "s"}
              </p>

              <hr className="rule-faint my-5" />

              <div className="eyebrow-tight pb-3">Top opponents</div>
              <div className="space-y-2">
                {(statsQ.data?.rows ?? []).slice(0, 8).map((r) => (
                  <Link
                    key={r.opp_civ_slug}
                    to="/notes/matchups/$myCiv/$oppCiv"
                    params={{ myCiv: slug, oppCiv: r.opp_civ_slug }}
                    className="flex items-baseline justify-between hover:underline font-display"
                    style={{ fontSize: 15 }}
                  >
                    <span className="italic text-[#5b574e]">
                      vs {prettyCiv(r.opp_civ_slug)}
                    </span>
                    <span>
                      {r.wins}–{r.losses}
                      {r.win_rate !== null && (
                        <span
                          className={`ml-2 italic ${r.win_rate >= 0.5 ? "" : "text-[#9b2b2b]"}`}
                        >
                          {(r.win_rate * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {(variants.length > 0 || parent) && (
            <>
              <hr className="rule-faint my-5" />
              <div className="eyebrow-tight pb-3">Related</div>
              <ul className="space-y-1 font-display" style={{ fontSize: 15 }}>
                {parent && (
                  <li>
                    <Link
                      to="/notes/civs/$slug"
                      params={{ slug: parent.slug }}
                      className="italic text-[#5b574e] hover:underline"
                    >
                      Parent: {parent.name}
                    </Link>
                  </li>
                )}
                {variants.map((v) => (
                  <li key={v.slug}>
                    <Link
                      to="/notes/civs/$slug"
                      params={{ slug: v.slug }}
                      className="italic text-[#5b574e] hover:underline"
                    >
                      Variant: {v.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <hr className="rule-faint my-5" />

          <div className="eyebrow-tight pb-3">Recent games</div>
          {(recentQ.data?.games ?? []).length === 0 ? (
            <p className="kicker">No games yet.</p>
          ) : (
            <ul className="space-y-1 font-display" style={{ fontSize: 15 }}>
              {recentQ.data?.games.map((g) => {
                const opp = g.participants.find((p) => !p.is_self);
                return (
                  <li key={g.id}>
                    <Link
                      to="/games/$gameId"
                      params={{ gameId: String(g.id) }}
                      className="hover:underline"
                    >
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
                          ? "W"
                          : g.my_result === "loss"
                            ? "L"
                            : "—"}
                      </span>{" "}
                      vs{" "}
                      <span className="italic">
                        {opp ? prettyCiv(opp.civ_slug) : "—"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
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

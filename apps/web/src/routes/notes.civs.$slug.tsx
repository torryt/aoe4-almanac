import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  api,
  qk,
  type Civ,
  type GameDto,
} from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";
import { MarkdownEditor } from "../components/MarkdownEditor.tsx";

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
      api.get<{ body_md: string; updated_at: number | null }>(`/notes/civs/${slug}`),
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
    queryFn: () =>
      api.get<{ games: GameDto[] }>(`/games?civ=${slug}&limit=5`),
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

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center gap-2">
          <Link to="/notes/civs" className="text-xs text-stone-500 hover:text-stone-900">
            ← All civ notes
          </Link>
        </div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">{civName}</h1>
          {civ?.is_variant && (
            <span className="text-xs text-amber-700">
              variant{parent && (
                <>
                  {" of "}
                  <Link
                    to="/notes/civs/$slug"
                    params={{ slug: parent.slug }}
                    className="underline"
                  >
                    {parent.name}
                  </Link>
                </>
              )}
            </span>
          )}
        </div>
        <Card title="General notes">
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate(draft)}
            saving={save.isPending}
            placeholder={`Write your ${civName} general strategy, build orders, key timings…`}
            minHeight={420}
          />
        </Card>
      </div>

      <div className="space-y-4">
        <Card title={`My ${civName} record`}>
          {totals.games === 0 ? (
            <div className="text-xs text-stone-500">No games yet.</div>
          ) : (
            <div className="space-y-2 text-sm">
              <div>
                <strong className="text-2xl tabular-nums">
                  {totals.wins}-{totals.losses}
                </strong>{" "}
                <span className="text-xs text-stone-500">
                  ({((totals.wins / totals.games) * 100).toFixed(1)}%)
                </span>
              </div>
              <div className="space-y-1 text-xs">
                {(statsQ.data?.rows ?? []).slice(0, 8).map((r) => (
                  <Link
                    key={r.opp_civ_slug}
                    to="/notes/matchups/$myCiv/$oppCiv"
                    params={{ myCiv: slug, oppCiv: r.opp_civ_slug }}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <span className="w-24 truncate">vs {r.opp_civ_slug}</span>
                    <span className="tabular-nums">
                      {r.wins}-{r.losses}
                    </span>
                    {r.win_rate !== null && (
                      <span
                        className={`tabular-nums ${
                          r.win_rate >= 0.5 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {(r.win_rate * 100).toFixed(0)}%
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>

        {(variants.length > 0 || parent) && (
          <Card title="Related civs">
            <ul className="space-y-1 text-sm">
              {parent && (
                <li>
                  <Link
                    to="/notes/civs/$slug"
                    params={{ slug: parent.slug }}
                    className="text-stone-700 hover:underline"
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
                    className="text-stone-700 hover:underline"
                  >
                    Variant: {v.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Recent games">
          {(recentQ.data?.games ?? []).length === 0 ? (
            <div className="text-xs text-stone-500">No games yet.</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {recentQ.data?.games.map((g) => (
                <li key={g.id}>
                  <Link
                    to="/games/$gameId"
                    params={{ gameId: String(g.id) }}
                    className="hover:underline"
                  >
                    {g.my_result === "win" ? "W" : g.my_result === "loss" ? "L" : "?"}{" "}
                    vs{" "}
                    {g.participants.find((p) => !p.is_self)?.civ_slug ?? "—"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

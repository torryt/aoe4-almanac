import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, qk, type Civ } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";
import { MarkdownEditor } from "../components/MarkdownEditor.tsx";

export const Route = createFileRoute("/notes/matchups/$myCiv/$oppCiv")({
  component: MatchupNoteEditor,
});

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

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Link
          to="/notes/matchups"
          className="text-xs text-stone-500 hover:text-stone-900"
        >
          ← Matchup grid
        </Link>
        <div className="flex items-center gap-2">
          <CivBadge
            slug={myCiv}
            name={my?.name}
            variant={my?.is_variant}
            size="md"
            link
          />
          <span className="text-stone-400">vs</span>
          <CivBadge
            slug={oppCiv}
            name={opp?.name}
            variant={opp?.is_variant}
            size="md"
            link
          />
        </div>
        <Card title="Matchup notes">
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate(draft)}
            saving={save.isPending}
            placeholder={`${my?.name ?? myCiv} vs ${opp?.name ?? oppCiv}: what to do, when, common opener responses…`}
            minHeight={420}
          />
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="1v1 record vs this civ">
          {stats ? (
            <div className="text-sm">
              <div className="mb-1 text-2xl font-semibold tabular-nums">
                {stats.wins}-{stats.losses}
              </div>
              {stats.win_rate !== null && (
                <div
                  className={`text-xs ${stats.win_rate >= 0.5 ? "text-emerald-700" : "text-rose-700"}`}
                >
                  {(stats.win_rate * 100).toFixed(1)}% win rate ({stats.games} games)
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-stone-500">No recorded games yet.</div>
          )}
        </Card>
        <Card title="Reverse matchup">
          <Link
            to="/notes/matchups/$myCiv/$oppCiv"
            params={{ myCiv: oppCiv, oppCiv: myCiv }}
            className="text-xs text-stone-700 hover:underline"
          >
            {opp?.name ?? oppCiv} → {my?.name ?? myCiv} →
          </Link>
        </Card>
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, qk } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { MarkdownEditor } from "../components/MarkdownEditor.tsx";

export const Route = createFileRoute("/notes/maps/$slug")({
  component: MapNoteEditor,
});

function MapNoteEditor() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const noteQ = useQuery({
    queryKey: qk.mapNote(slug),
    queryFn: () =>
      api.get<{ body_md: string; updated_at: number | null }>(
        `/notes/maps/${slug}`,
      ),
  });
  const statsQ = useQuery({
    queryKey: qk.statsByMap,
    queryFn: () =>
      api.get<{
        rows: Array<{
          map_slug: string;
          games: number;
          wins: number;
          losses: number;
          win_rate: number | null;
        }>;
      }>("/stats/by-map"),
  });
  const myStats = (statsQ.data?.rows ?? []).find((r) => r.map_slug === slug);

  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(noteQ.data?.body_md ?? "");
  }, [noteQ.data?.body_md]);

  const save = useMutation({
    mutationFn: (body_md: string) =>
      api.put<{ ok: true }>(`/notes/maps/${slug}`, { body_md }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mapNote(slug) });
      qc.invalidateQueries({ queryKey: qk.mapNotes });
    },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <Link
          to="/notes/maps"
          className="text-xs text-stone-500 hover:text-stone-900"
        >
          ← All map notes
        </Link>
        <h1 className="text-xl font-semibold">{slug}</h1>
        <Card title="Map notes">
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            onSave={() => save.mutate(draft)}
            saving={save.isPending}
            placeholder={`Spawns, sacred sites, key timings on ${slug}…`}
            minHeight={420}
          />
        </Card>
      </div>
      <div>
        <Card title="My record on this map">
          {myStats ? (
            <div>
              <div className="text-2xl font-semibold tabular-nums">
                {myStats.wins}-{myStats.losses}
              </div>
              {myStats.win_rate !== null && (
                <div
                  className={`text-xs ${myStats.win_rate >= 0.5 ? "text-emerald-700" : "text-rose-700"}`}
                >
                  {(myStats.win_rate * 100).toFixed(1)}% ({myStats.games} games)
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-stone-500">No games yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

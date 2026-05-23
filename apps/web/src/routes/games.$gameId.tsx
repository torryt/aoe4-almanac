import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, qk, type Civ, type GameDto } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";
import { ResultBadge } from "../components/ResultBadge.tsx";
import { MarkdownEditor } from "../components/MarkdownEditor.tsx";

export const Route = createFileRoute("/games/$gameId")({
  component: GameDetail,
});

type GameDetailDto = GameDto & {
  map_slug: string | null;
  duration_seconds: number | null;
  raw_payload: unknown;
};

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

function fmtDuration(s: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
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
      api.get<{ body_md: string; updated_at: number | null }>(`/notes/games/${id}`),
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

  if (gameQ.isLoading) return <div className="text-sm text-stone-500">Loading…</div>;
  if (gameQ.isError || !gameQ.data)
    return <div className="text-sm text-rose-700">Game not found.</div>;

  const g = gameQ.data;
  const civMap = new Map((civsQ.data?.civs ?? []).map((c) => [c.slug, c]));
  const myCivInfo = civMap.get(g.my_civ_slug);
  const oppParts = g.participants.filter((p) => !p.is_self);

  return (
    <div className="space-y-4">
      <Link
        to="/games"
        className="text-xs text-stone-500 hover:text-stone-900"
      >
        ← Back to games
      </Link>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ResultBadge result={g.my_result} />
              <CivBadge
                slug={g.my_civ_slug}
                name={myCivInfo?.name}
                variant={myCivInfo?.is_variant}
                size="md"
                link
              />
              <span className="text-stone-400">vs</span>
              {oppParts.length === 0 ? (
                <span className="text-sm text-stone-500">(no opponent recorded)</span>
              ) : (
                oppParts.map((p) => {
                  const info = civMap.get(p.civ_slug);
                  return (
                    <CivBadge
                      key={p.id}
                      slug={p.civ_slug}
                      name={info?.name}
                      variant={info?.is_variant}
                      size="md"
                    />
                  );
                })
              )}
            </div>
            <div className="mt-1 text-xs text-stone-500">
              {fmtDate(g.started_at)} · {g.kind}
              {g.map_slug && ` · map: ${g.map_slug}`}
              {" · "}duration {fmtDuration(g.duration_seconds)}
              {g.my_rating_diff !== null && (
                <span
                  className={`ml-2 ${g.my_rating_diff > 0 ? "text-emerald-700" : g.my_rating_diff < 0 ? "text-rose-700" : ""}`}
                >
                  Δ{g.my_rating_diff > 0 ? "+" : ""}
                  {g.my_rating_diff}
                </span>
              )}
            </div>
            {g.aoe4world_game_id && (
              <div className="mt-1">
                <a
                  href={`https://aoe4world.com/players/games/${g.aoe4world_game_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-stone-500 underline hover:text-stone-900"
                >
                  View on aoe4world ↗
                </a>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title="Participants">
        <table className="w-full text-sm">
          <thead className="text-xs text-stone-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Team</th>
              <th className="px-2 py-1 text-left font-medium">Name</th>
              <th className="px-2 py-1 text-left font-medium">Civ</th>
              <th className="px-2 py-1 text-left font-medium">Result</th>
              <th className="px-2 py-1 text-right font-medium">Rating</th>
              <th className="px-2 py-1 text-right font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {g.participants.map((p) => {
              const info = civMap.get(p.civ_slug);
              return (
                <tr key={p.id} className="border-t border-stone-100">
                  <td className="px-2 py-1.5">{p.team + 1}</td>
                  <td className="px-2 py-1.5">
                    {p.is_self ? <strong>{p.name}</strong> : p.name}
                  </td>
                  <td className="px-2 py-1.5">
                    <CivBadge
                      slug={p.civ_slug}
                      name={info?.name}
                      variant={info?.is_variant}
                      size="xs"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <ResultBadge result={p.result} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {p.rating ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {p.rating_diff !== null
                      ? `${p.rating_diff > 0 ? "+" : ""}${p.rating_diff}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Notes for this game">
        <MarkdownEditor
          value={draft}
          onChange={setDraft}
          onSave={() => saveNote.mutate(draft)}
          saving={saveNote.isPending}
        />
      </Card>
    </div>
  );
}

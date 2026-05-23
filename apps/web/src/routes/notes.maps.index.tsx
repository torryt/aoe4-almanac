import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api, qk } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";

export const Route = createFileRoute("/notes/maps/")({
  component: MapNotesIndex,
});

function MapNotesIndex() {
  const notesQ = useQuery({
    queryKey: qk.mapNotes,
    queryFn: () =>
      api.get<{
        notes: Array<{ map_slug: string; updated_at: number; excerpt: string }>;
      }>("/notes/maps"),
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

  const stats = statsQ.data?.rows ?? [];
  const noteByMap = new Map(
    (notesQ.data?.notes ?? []).map((n) => [n.map_slug, n]),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Map notes</h1>
      <Card title="Maps you've played">
        {stats.length === 0 ? (
          <div className="text-sm text-stone-500">
            No map data yet. Sync games or log manually.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100">
            {stats.map((r) => {
              const note = noteByMap.get(r.map_slug);
              return (
                <li key={r.map_slug}>
                  <Link
                    to="/notes/maps/$slug"
                    params={{ slug: r.map_slug }}
                    className="flex items-center gap-3 py-2 hover:bg-stone-50"
                  >
                    <span className="w-40 truncate text-sm font-medium">
                      {r.map_slug}
                    </span>
                    <span className="text-xs tabular-nums text-stone-600">
                      {r.wins}-{r.losses}
                    </span>
                    {r.win_rate !== null && (
                      <span
                        className={`text-xs ${r.win_rate >= 0.5 ? "text-emerald-700" : "text-rose-700"}`}
                      >
                        {(r.win_rate * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className="flex-1 truncate text-xs text-stone-500">
                      {note?.excerpt ?? ""}
                    </span>
                    {note && <span className="text-xs text-emerald-700">●</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

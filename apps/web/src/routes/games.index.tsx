import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { api, qk, type Civ, type GameDto } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";
import { ResultBadge } from "../components/ResultBadge.tsx";

const gamesSearchSchema = z.object({
  civ: z.string().optional(),
  opp_civ: z.string().optional(),
  map: z.string().optional(),
  result: z.enum(["win", "loss", "draw"]).optional(),
  kind: z.string().optional(),
});

export const Route = createFileRoute("/games/")({
  validateSearch: gamesSearchSchema,
  component: GamesList,
});

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

function GamesList() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();

  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const civs = civsQ.data?.civs ?? [];

  const games = useQuery({
    queryKey: qk.games(search),
    queryFn: () =>
      api.get<{ games: GameDto[]; next_cursor: number | null }>(
        `/games${qs ? `?${qs}` : ""}`,
      ),
  });

  function update(key: string, value: string | undefined): void {
    const next = { ...search, [key]: value || undefined } as Record<
      string,
      string | undefined
    >;
    void navigate({ search: next });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Games</h1>
        <Link
          to="/games/new"
          className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white"
        >
          + Manual entry
        </Link>
      </div>

      <Card title="Filters">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FilterSelect
            label="My civ"
            value={search.civ}
            onChange={(v) => update("civ", v)}
            options={civs}
          />
          <FilterSelect
            label="Opp civ"
            value={search.opp_civ}
            onChange={(v) => update("opp_civ", v)}
            options={civs}
          />
          <div>
            <label className="block text-xs font-medium text-stone-500">
              Result
            </label>
            <select
              value={search.result ?? ""}
              onChange={(e) => update("result", e.target.value || undefined)}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="draw">Draw</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500">Kind</label>
            <select
              value={search.kind ?? ""}
              onChange={(e) => update("kind", e.target.value || undefined)}
              className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              <option value="rm_1v1">Ranked 1v1</option>
              <option value="rm_2v2">Ranked 2v2</option>
              <option value="rm_3v3">Ranked 3v3</option>
              <option value="rm_4v4">Ranked 4v4</option>
              <option value="qm_1v1">Quick 1v1</option>
              <option value="custom">Custom</option>
              <option value="manual">Manual</option>
            </select>
          </div>
        </div>
      </Card>

      <Card>
        {games.isLoading ? (
          <div className="text-sm text-stone-500">Loading…</div>
        ) : (games.data?.games ?? []).length === 0 ? (
          <div className="text-sm text-stone-500">No games match these filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-stone-500">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Result</th>
                <th className="px-2 py-1 text-left font-medium">My civ</th>
                <th className="px-2 py-1 text-left font-medium">Opp</th>
                <th className="px-2 py-1 text-left font-medium">Map</th>
                <th className="px-2 py-1 text-left font-medium">Kind</th>
                <th className="px-2 py-1 text-right font-medium">Δ</th>
                <th className="px-2 py-1 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {games.data?.games.map((g) => {
                const opp = g.participants.find((p) => !p.is_self);
                return (
                  <tr
                    key={g.id}
                    className="cursor-pointer border-t border-stone-100 hover:bg-stone-50"
                    onClick={() =>
                      void navigate({
                        to: "/games/$gameId",
                        params: { gameId: String(g.id) },
                      })
                    }
                  >
                    <td className="px-2 py-1.5">
                      <ResultBadge result={g.my_result} />
                    </td>
                    <td className="px-2 py-1.5">
                      <CivBadge slug={g.my_civ_slug} size="xs" />
                    </td>
                    <td className="px-2 py-1.5">
                      {opp ? <CivBadge slug={opp.civ_slug} size="xs" /> : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-stone-600">{g.map_slug ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs text-stone-500">{g.kind}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {g.my_rating_diff !== null
                        ? `${g.my_rating_diff > 0 ? "+" : ""}${g.my_rating_diff}`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs text-stone-500 tabular-nums">
                      {fmtDate(g.started_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function FilterSelect(props: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Civ[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-500">{props.label}</label>
      <select
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.target.value || undefined)}
        className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
      >
        <option value="">Any</option>
        {props.options.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
            {c.is_variant ? " (var)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

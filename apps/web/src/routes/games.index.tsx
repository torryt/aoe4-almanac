import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import {
  api,
  qk,
  type Civ,
  type GameDto,
  type GameNoteBatchEntry,
} from "../lib/api.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from "../components/ui/index.ts";
import { prettyCiv, prettyMap } from "./index.tsx";

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

function fmtDay(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })}`;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
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

  const gameIds = (games.data?.games ?? []).map((g) => g.id);
  const gameNotesQ = useQuery({
    queryKey: qk.gameNotesBatch(gameIds),
    queryFn: () =>
      api.get<{ notes: GameNoteBatchEntry[] }>(
        `/notes/games?ids=${gameIds.join(",")}`,
      ),
    enabled: gameIds.length > 0,
  });
  const notedGameIds = new Set<number>();
  for (const n of gameNotesQ.data?.notes ?? []) {
    if (n.body_md.trim()) notedGameIds.add(n.game_id);
  }

  function update(key: string, value: string | undefined): void {
    const next = { ...search, [key]: value || undefined } as Record<
      string,
      string | undefined
    >;
    void navigate({ search: next });
  }

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-3">
          <div className="eyebrow-tight pb-4">The Ledger</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 56,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            The Bound
            <br />
            Ledger.
          </h2>
          <p className="kicker pt-4" style={{ fontSize: 14 }}>
            Every recorded campaign, sortable by hand and machine alike.
          </p>
          <hr className="rule-gold my-6" />

          <div className="mt-8 space-y-5">
            <div>
              <Label>My Civilization</Label>
              <Select
                value={search.civ ?? "__all"}
                onValueChange={(v) => update("civ", v === "__all" ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Any</SelectItem>
                  {civs.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                      {c.is_variant ? " (variant)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Opponent</Label>
              <Select
                value={search.opp_civ ?? "__all"}
                onValueChange={(v) =>
                  update("opp_civ", v === "__all" ? undefined : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Any</SelectItem>
                  {civs.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Result</Label>
              <Select
                value={search.result ?? "__all"}
                onValueChange={(v) =>
                  update("result", v === "__all" ? undefined : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Any</SelectItem>
                  <SelectItem value="win">Victory</SelectItem>
                  <SelectItem value="loss">Defeat</SelectItem>
                  <SelectItem value="draw">Draw</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Kind</Label>
              <Select
                value={search.kind ?? "__all"}
                onValueChange={(v) =>
                  update("kind", v === "__all" ? undefined : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Any</SelectItem>
                  <SelectItem value="rm_1v1">Ranked 1v1</SelectItem>
                  <SelectItem value="rm_2v2">Ranked 2v2</SelectItem>
                  <SelectItem value="rm_3v3">Ranked 3v3</SelectItem>
                  <SelectItem value="rm_4v4">Ranked 4v4</SelectItem>
                  <SelectItem value="qm_1v1">Quick 1v1</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="col-span-9">
          <div
            className="log-row"
            style={{
              borderBottom: "2px solid #1c1c1a",
              paddingBottom: 8,
              paddingTop: 0,
            }}
          >
            <div className="eyebrow-tight">Date</div>
            <div className="eyebrow-tight">Matchup</div>
            <div className="eyebrow-tight">Map</div>
            <div className="eyebrow-tight text-right">Duration</div>
            <div className="eyebrow-tight text-center">Result</div>
            <div className="eyebrow-tight text-right">Δ MMR</div>
          </div>

          {games.isLoading ? (
            <div className="kicker py-6">Loading the ledger…</div>
          ) : (games.data?.games ?? []).length === 0 ? (
            <div className="kicker py-6">No games match the present filters.</div>
          ) : (
            games.data?.games.map((g) => {
              const opp = g.participants.find((p) => !p.is_self);
              return (
                <Link
                  key={g.id}
                  to="/games/$gameId"
                  params={{ gameId: String(g.id) }}
                  className="log-row hover:bg-[rgba(28,28,26,0.04)]"
                >
                  <div
                    className="font-display"
                    style={{ fontSize: 17, fontWeight: 600 }}
                  >
                    {fmtDay(g.started_at)}
                  </div>
                  <div className="font-display" style={{ fontSize: 17 }}>
                    <span className="text-[#9b2b2b]">
                      {prettyCiv(g.my_civ_slug)}
                    </span>{" "}
                    <span className="text-[#5b574e] italic">vs</span>{" "}
                    {opp ? (
                      prettyCiv(opp.civ_slug)
                    ) : (
                      <span className="text-[#5b574e] italic">—</span>
                    )}
                    {notedGameIds.has(g.id) ? (
                      <span
                        className="text-[#5b574e]"
                        title="Annotated"
                        style={{
                          marginLeft: 8,
                          fontSize: 13,
                          verticalAlign: "super",
                        }}
                      >
                        †
                      </span>
                    ) : null}
                  </div>
                  <div className="font-display italic" style={{ fontSize: 16 }}>
                    {g.map_slug ? prettyMap(g.map_slug) : "—"}
                  </div>
                  <div
                    className="font-display text-right"
                    style={{ fontSize: 16, fontWeight: 500 }}
                  >
                    {fmtDuration(g.duration_seconds)}
                  </div>
                  <div
                    className={`text-center font-display ${
                      g.my_result === "win"
                        ? "result-W"
                        : g.my_result === "loss"
                          ? "result-L"
                          : "result-D"
                    }`}
                    style={{ fontSize: 17 }}
                  >
                    {g.my_result === "win"
                      ? "W"
                      : g.my_result === "loss"
                        ? "L"
                        : g.my_result === "draw"
                          ? "D"
                          : "—"}
                  </div>
                  <div
                    className={`font-display text-right ${g.my_rating_diff !== null && g.my_rating_diff < 0 ? "text-[#9b2b2b]" : ""}`}
                    style={{ fontSize: 16 }}
                  >
                    {g.my_rating_diff === null
                      ? "—"
                      : g.my_rating_diff < 0
                        ? `−${Math.abs(g.my_rating_diff)}`
                        : `+${g.my_rating_diff}`}
                  </div>
                </Link>
              );
            })
          )}

          <div className="flex items-center justify-between pt-6">
            <span className="kicker">
              {games.data?.games.length ?? 0} entries shown.
            </span>
            <span className="folio">page 4</span>
          </div>
        </div>
      </div>
    </section>
  );
}

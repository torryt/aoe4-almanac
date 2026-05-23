import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { KNIGHTS_TEMPLAR, canonicalCivSlug } from "@aoe4-almanac/shared";
import { api, qk, type Civ } from "../lib/api.ts";
import { useCivNames } from "../lib/civNames.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/index.ts";

const matchupSearch = z.object({ my_civ: z.string().optional() });

export const Route = createFileRoute("/notes/matchups/")({
  validateSearch: matchupSearch,
  component: MatchupGrid,
});

function MatchupGrid() {
  const { my_civ } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { nameOf } = useCivNames();
  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const notesQ = useQuery({
    queryKey: qk.matchupNotes(),
    queryFn: () =>
      api.get<{
        notes: Array<{
          my_civ_slug: string;
          opp_civ_slug: string;
          excerpt: string;
          updated_at: number;
        }>;
      }>("/notes/matchups"),
  });
  const matrixQ = useQuery({
    queryKey: qk.statsMatchups,
    queryFn: () =>
      api.get<{
        rows: Array<{
          my_civ_slug: string;
          opp_civ_slug: string;
          games: number;
          wins: number;
          losses: number;
          draws: number;
          win_rate: number | null;
        }>;
      }>("/stats/matchups"),
  });
  const matrixByKey = new Map(
    (matrixQ.data?.rows ?? []).map((r) => [
      `${r.my_civ_slug}|${r.opp_civ_slug}`,
      r,
    ]),
  );

  const allCivs = civsQ.data?.civs ?? [];
  const orderedCivs: Civ[] = [];
  const bases = allCivs.filter((c) => !c.is_variant);
  for (const b of bases) {
    orderedCivs.push(b);
    for (const v of allCivs.filter((c) => c.parent_slug === b.slug)) {
      orderedCivs.push(v);
    }
  }

  const notesSet = new Set(
    (notesQ.data?.notes ?? []).map((n) => `${n.my_civ_slug}|${n.opp_civ_slug}`),
  );
  const notedCount = notesSet.size;
  const totalCells = orderedCivs.length * (orderedCivs.length - 1);
  const explored = totalCells > 0 ? (notedCount / totalCells) * 100 : 0;

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10 items-start">
        <div className="col-span-3">
          <div className="eyebrow-tight pb-4">A Cartography of Opponents</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 60,
              lineHeight: 0.92,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            The
            <br />
            Matchup
            <br />
            Table.
          </h2>
          <hr className="rule-gold my-5" />
          <p className="marginalia">
            Read the rows as the proprietor's civilisation, the columns as the
            opponent's. A{" "}
            <span className="text-[#9b2b2b]">•</span> indicates a standing note
            on file; an open ring marks an absence. Variant civilisations are
            indented beneath their parent, by convention.
          </p>

          <hr className="rule-faint my-5" />

          <div className="eyebrow-tight pb-3">Legend</div>
          <div className="font-display" style={{ fontSize: 14, lineHeight: 1.9 }}>
            <div className="flex items-baseline gap-3">
              <span
                className="inline-block"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#9b2b2b",
                  transform: "translateY(-2px)",
                }}
              />
              <span>Note present</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span
                className="inline-block"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  border: "1px solid #1c1c1a",
                  boxSizing: "border-box",
                  transform: "translateY(-2px)",
                }}
              />
              <span>
                No note — <em>terra incognita</em>
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <span
                className="inline-block"
                style={{
                  width: 12,
                  height: 8,
                  background:
                    "repeating-linear-gradient(45deg, transparent 0, transparent 2px, rgba(28,28,26,0.4) 2px, rgba(28,28,26,0.4) 3px)",
                }}
              />
              <span>Mirror match (notes allowed)</span>
            </div>
          </div>

          <hr className="rule-faint my-5" />

          <div className="eyebrow-tight pb-3">Focus</div>
          <Select
            value={my_civ ?? "__all"}
            onValueChange={(v) =>
              void navigate({
                search: v === "__all" ? {} : { my_civ: v },
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="All civilisations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All civilisations</SelectItem>
              {orderedCivs.map((c) => (
                <SelectItem key={c.slug} value={c.slug}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-9">
          <div
            style={{
              background: "#ece6db",
              padding: "22px 22px 28px",
              borderTop: "2px solid #1c1c1a",
              borderBottom: "1px solid rgba(28,28,26,0.4)",
            }}
          >
            <div className="flex items-baseline justify-between pb-3">
              <div className="eyebrow-tight">
                Your civilisation × Opponent's civilisation
              </div>
              <div className="kicker" style={{ fontSize: 12 }}>
                {totalCells} cells · {notedCount} noted ·{" "}
                {explored.toFixed(1)}% explored
              </div>
            </div>

            {orderedCivs.length === 0 ? (
              <div className="kicker py-6">Loading civilisations…</div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `138px repeat(${orderedCivs.length}, 1fr)`,
                    alignItems: "end",
                  }}
                >
                  <div />
                  {orderedCivs.map((c) => (
                    <div
                      key={c.slug}
                      className="flex justify-center"
                      style={{ height: 90 }}
                    >
                      <span
                        className={`col-label ${c.is_variant ? "variant" : ""} ${c.slug === KNIGHTS_TEMPLAR ? "main" : ""}`}
                      >
                        {c.name}
                      </span>
                    </div>
                  ))}
                </div>

                {(my_civ
                  ? orderedCivs.filter(
                      (c) => c.slug === canonicalCivSlug(my_civ),
                    )
                  : orderedCivs
                ).map(
                  (rowCiv) => (
                    <div
                      key={rowCiv.slug}
                      style={{
                        display: "grid",
                        gridTemplateColumns: `138px repeat(${orderedCivs.length}, 1fr)`,
                        alignItems: "stretch",
                      }}
                    >
                      <div
                        className={`row-label ${rowCiv.is_variant ? "variant" : ""} ${rowCiv.slug === KNIGHTS_TEMPLAR ? "main" : ""}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-end",
                        }}
                      >
                        {rowCiv.name}
                      </div>
                      {orderedCivs.map((colCiv) => {
                        const isMirror = rowCiv.slug === colCiv.slug;
                        const has = notesSet.has(
                          `${rowCiv.slug}|${colCiv.slug}`,
                        );
                        const stats = matrixByKey.get(
                          `${rowCiv.slug}|${colCiv.slug}`,
                        );
                        return (
                          <Tooltip key={colCiv.slug}>
                            <TooltipTrigger asChild>
                              <Link
                                to="/notes/matchups/$myCiv/$oppCiv"
                                params={{
                                  myCiv: rowCiv.slug,
                                  oppCiv: colCiv.slug,
                                }}
                                className={`grid-cell ${isMirror ? "diag" : ""}`}
                              >
                                <span
                                  className={`dot ${has ? "filled" : "hollow"}`}
                                />
                                {stats && stats.games > 0 && stats.win_rate !== null && (
                                  <span className="wr">
                                    {Math.round(stats.win_rate * 100)}
                                  </span>
                                )}
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                              {rowCiv.name} vs {colCiv.name}
                              {isMirror ? " · mirror" : ""}
                              {has ? " · noted" : ""}
                              {stats && stats.games > 0 && (
                                <>
                                  {" · "}
                                  {stats.wins}W–{stats.losses}L
                                  {stats.draws > 0 ? `–${stats.draws}D` : ""}
                                  {stats.win_rate !== null && (
                                    <>
                                      {" ("}
                                      {(stats.win_rate * 100).toFixed(0)}%)
                                    </>
                                  )}
                                </>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ),
                )}
              </>
            )}

            <hr className="rule-faint mt-5" />
            <div className="flex items-center justify-between pt-3">
              <span className="kicker" style={{ fontSize: 12 }}>
                {my_civ ? (
                  <>
                    Filtered to <em className="text-[#9b2b2b]">{nameOf(my_civ)}</em> · click any cell
                    to open the matchup note.
                  </>
                ) : (
                  <>Click any cell to open the matchup note.</>
                )}
              </span>
              <span className="folio">page 7</span>
            </div>
          </div>

          {(notesQ.data?.notes ?? []).length > 0 && (
            <div className="mt-10">
              <div className="flex items-center gap-4 pb-4">
                <span className="eyebrow">Recent matchup essays</span>
                <hr className="rule-faint flex-1" />
              </div>
              <ul>
                {notesQ.data?.notes.slice(0, 6).map((n) => (
                  <li
                    key={`${n.my_civ_slug}|${n.opp_civ_slug}`}
                    className="border-b border-[rgba(28,28,26,0.1)]"
                  >
                    <Link
                      to="/notes/matchups/$myCiv/$oppCiv"
                      params={{ myCiv: n.my_civ_slug, oppCiv: n.opp_civ_slug }}
                      className="flex items-baseline gap-4 py-3 hover:bg-[rgba(28,28,26,0.04)]"
                    >
                      <div
                        className="font-display"
                        style={{ fontSize: 18, fontWeight: 600, minWidth: 180 }}
                      >
                        <span className="text-[#9b2b2b]">{nameOf(n.my_civ_slug)}</span>{" "}
                        <span className="text-[#5b574e] italic">vs</span>{" "}
                        {nameOf(n.opp_civ_slug)}
                      </div>
                      <div
                        className="font-display italic flex-1 truncate"
                        style={{ fontSize: 15, color: "#5b574e" }}
                      >
                        {n.excerpt || "(empty note)"}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { api, qk, type Civ } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";

const matchupSearch = z.object({ my_civ: z.string().optional() });

export const Route = createFileRoute("/notes/matchups/")({
  validateSearch: matchupSearch,
  component: MatchupGrid,
});

function MatchupGrid() {
  const { my_civ } = Route.useSearch();
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

  const allCivs = civsQ.data?.civs ?? [];
  // Group: base civ + its variants
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

  const filterMyCiv = my_civ;
  const rowCivs = filterMyCiv
    ? orderedCivs.filter((c) => c.slug === filterMyCiv)
    : orderedCivs;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Matchup notes</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-stone-500">My civ:</span>
          <Link
            to="/notes/matchups"
            search={{}}
            className={`rounded px-2 py-1 ${!filterMyCiv ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}
          >
            All
          </Link>
          {bases.slice(0, 6).map((c) => (
            <Link
              key={c.slug}
              to="/notes/matchups"
              search={{ my_civ: c.slug }}
              className={`rounded px-2 py-1 ${filterMyCiv === c.slug ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}
            >
              {c.name}
            </Link>
          ))}
          <select
            value={filterMyCiv ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              window.location.search = v ? `?my_civ=${v}` : "";
            }}
            className="rounded border border-stone-300 px-2 py-1"
          >
            <option value="">— pick civ —</option>
            {orderedCivs.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        {orderedCivs.length === 0 ? (
          <div className="text-sm text-stone-500">Loading civs…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left text-stone-500"></th>
                  {orderedCivs.map((c) => (
                    <th
                      key={c.slug}
                      className="whitespace-nowrap px-1 py-1 text-left font-medium text-stone-500"
                    >
                      <span
                        title={c.name}
                        className={c.is_variant ? "text-amber-700" : ""}
                      >
                        {c.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowCivs.map((my) => (
                  <tr key={my.slug} className="border-t border-stone-100">
                    <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left">
                      <CivBadge
                        slug={my.slug}
                        name={my.name}
                        variant={my.is_variant}
                        size="xs"
                      />
                    </th>
                    {orderedCivs.map((opp) => {
                      const has = notesSet.has(`${my.slug}|${opp.slug}`);
                      return (
                        <td key={opp.slug} className="p-0">
                          <Link
                            to="/notes/matchups/$myCiv/$oppCiv"
                            params={{ myCiv: my.slug, oppCiv: opp.slug }}
                            className="flex h-7 w-7 items-center justify-center hover:bg-stone-100"
                            title={`${my.name} vs ${opp.name}`}
                          >
                            {has ? (
                              <span className="size-2 rounded-full bg-emerald-600" />
                            ) : (
                              <span className="size-1 rounded-full bg-stone-200" />
                            )}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(notesQ.data?.notes ?? []).length > 0 && (
        <Card title="Recent matchup notes">
          <ul className="divide-y divide-stone-100">
            {notesQ.data?.notes.slice(0, 10).map((n) => (
              <li key={`${n.my_civ_slug}|${n.opp_civ_slug}`}>
                <Link
                  to="/notes/matchups/$myCiv/$oppCiv"
                  params={{ myCiv: n.my_civ_slug, oppCiv: n.opp_civ_slug }}
                  className="flex items-center gap-2 py-2 hover:underline"
                >
                  <CivBadge slug={n.my_civ_slug} size="xs" />
                  <span className="text-stone-400">vs</span>
                  <CivBadge slug={n.opp_civ_slug} size="xs" />
                  <span className="flex-1 truncate text-xs text-stone-600">
                    {n.excerpt}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

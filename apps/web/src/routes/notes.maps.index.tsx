import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api, qk } from "../lib/api.ts";
import { prettyMap } from "./index.tsx";

export const Route = createFileRoute("/notes/maps/")({
  component: MapNotesIndex,
});

const ROMAN_NUMS = [
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
  "xii",
  "xiii",
  "xiv",
  "xv",
  "xvi",
];

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
  const noted = (notesQ.data?.notes ?? []).length;
  const totalMaps = stats.length;
  const draftCount = Math.max(0, totalMaps - noted);

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-4">
          <div className="eyebrow-tight pb-4">The Atlas</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 60,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            On Ground
            <br />
            Familiar &amp;
            <br />
            Unfamiliar.
          </h2>
          <hr className="rule-gold my-5" />
          <p className="marginalia">
            Every map you've stepped foot upon. The proprietor has committed{" "}
            {noted} note{noted === 1 ? "" : "s"} to permanent record;{" "}
            {draftCount} remain in draft.
          </p>
          <hr className="rule-faint my-5" />
          <p className="kicker" style={{ fontSize: 14 }}>
            <span className="smallcaps text-[#5b574e]">A note on the figures</span>{" "}
            — W/L is given across every recorded game on the map, not filtered
            by civilisation.
          </p>
        </div>

        <div className="col-span-8">
          {stats.length === 0 ? (
            <div className="kicker py-6">
              No maps recorded yet. Sync games from{" "}
              <Link to="/settings" className="underline">
                Settings
              </Link>{" "}
              or{" "}
              <Link to="/games/new" className="underline">
                log a manual game
              </Link>
              .
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-5">
              {stats.map((r, idx) => {
                const note = noteByMap.get(r.map_slug);
                const wr = r.win_rate;
                return (
                  <Link
                    key={r.map_slug}
                    to="/notes/maps/$slug"
                    params={{ slug: r.map_slug }}
                    className="map-card block hover:bg-[#ddd5c4]"
                  >
                    <span className="corner">{ROMAN_NUMS[idx] ?? "—"}.</span>
                    <div className="eyebrow-tight pb-2">
                      {note ? "Noted" : "Draft"}
                    </div>
                    <h3
                      className="font-display"
                      style={{
                        fontSize: 26,
                        lineHeight: 1,
                        fontWeight: 600,
                      }}
                    >
                      {prettyMap(r.map_slug)}
                    </h3>
                    <hr className="rule-faint my-3" />
                    <div className="flex items-baseline justify-between">
                      <div
                        className="font-display"
                        style={{ fontSize: 24, fontWeight: 600 }}
                      >
                        {r.wins}
                        <span className="text-[#5b574e] italic font-normal">
                          –
                        </span>
                        {r.losses}
                      </div>
                      <div className="kicker" style={{ fontSize: 13 }}>
                        {wr !== null ? `${(wr * 100).toFixed(0)}%` : "—"}
                      </div>
                    </div>
                    <p
                      className={`kicker pt-3 ${note ? "" : "text-[#9b2b2b]"}`}
                      style={{ fontSize: 12 }}
                    >
                      {note ? (
                        note.excerpt ? (
                          <span className="italic">
                            {note.excerpt.slice(0, 80)}
                            {note.excerpt.length > 80 ? "…" : ""}
                          </span>
                        ) : (
                          "A note is on file."
                        )
                      ) : (
                        <>
                          No note — <em>still to write</em>
                        </>
                      )}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-6">
            <span className="kicker">
              {totalMaps} map{totalMaps === 1 ? "" : "s"} on file.
            </span>
            <span className="folio">page 12</span>
          </div>
        </div>
      </div>
    </section>
  );
}

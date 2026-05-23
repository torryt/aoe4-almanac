import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api, qk, type OpponentDetail } from "../lib/api.ts";
import { prettyCiv, prettyMap } from "./index.tsx";

export const Route = createFileRoute("/opponents/$key")({
  component: OpponentDetailPage,
});

function fmtDay(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })} ${d.getFullYear()}`;
}

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtPct(p: number | null): string {
  if (p === null) return "—";
  return `${Math.round(p * 100)}%`;
}

function OpponentDetailPage() {
  const { key } = Route.useParams();
  const detailQ = useQuery({
    queryKey: qk.opponent(key),
    queryFn: () =>
      api.get<OpponentDetail>(`/opponents/${encodeURIComponent(key)}`),
  });

  if (detailQ.isLoading) {
    return (
      <section className="spread px-10 pt-16 pb-20">
        <div className="kicker">Reading the dossier…</div>
      </section>
    );
  }

  if (detailQ.isError || !detailQ.data) {
    return (
      <section className="spread px-10 pt-16 pb-20">
        <p className="kicker">No record of this opponent.</p>
        <Link
          to="/opponents"
          className="nav-link"
        >
          ← Back to the rolls
        </Link>
      </section>
    );
  }

  const d = detailQ.data;
  const o = d.opponent;

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-4">
          <Link to="/opponents" className="eyebrow-tight">
            ← The Adversaries
          </Link>
          <div className="eyebrow-tight pt-3 pb-4">A Dossier</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 56,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            {o.name}
          </h2>
          {o.profile_id === null ? (
            <p className="kicker pt-2 italic text-[#5b574e]">
              Unlinked from aoe4world — matched by name alone.
            </p>
          ) : (
            <p className="kicker pt-2 text-[#5b574e]">
              aoe4world profile #{o.profile_id}
            </p>
          )}

          <hr className="rule-gold my-5" />

          <div className="space-y-3">
            <StatLine label="Total engagements" value={String(o.games)} />
            <StatLine
              label="Record"
              value={`${o.wins}W · ${o.losses}L${o.draws > 0 ? ` · ${o.draws}D` : ""}`}
            />
            <StatLine label="Win rate" value={fmtPct(o.win_rate)} />
            {o.first_played_at && (
              <StatLine
                label="First met"
                value={fmtDay(o.first_played_at)}
              />
            )}
            {o.last_played_at && (
              <StatLine label="Last met" value={fmtDay(o.last_played_at)} />
            )}
          </div>

          <hr className="rule-faint my-6" />

          {d.by_opp_civ.length > 0 && (
            <>
              <p className="eyebrow-tight pb-3">Their civilisations</p>
              <BreakdownList rows={d.by_opp_civ} fmt={prettyCiv} />
            </>
          )}

          {d.by_my_civ.length > 0 && (
            <>
              <p className="eyebrow-tight pb-3 pt-6">My civilisations</p>
              <BreakdownList rows={d.by_my_civ} fmt={prettyCiv} />
            </>
          )}

          {d.by_map.length > 0 && (
            <>
              <p className="eyebrow-tight pb-3 pt-6">Maps</p>
              <BreakdownList
                rows={d.by_map.map((r) => ({
                  civ_slug: r.map_slug,
                  games: r.games,
                  wins: r.wins,
                  losses: r.losses,
                  win_rate: r.win_rate,
                }))}
                fmt={prettyMap}
              />
            </>
          )}
        </div>

        <div className="col-span-8">
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

          {d.games.map((g) => (
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
                <span className="text-[#9b2b2b]">{prettyCiv(g.my_civ_slug)}</span>{" "}
                <span className="text-[#5b574e] italic">vs</span>{" "}
                {prettyCiv(g.opp_civ_slug)}
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
                className={`font-display text-right ${
                  g.my_rating_diff !== null && g.my_rating_diff < 0
                    ? "text-[#9b2b2b]"
                    : ""
                }`}
                style={{ fontSize: 16 }}
              >
                {g.my_rating_diff === null
                  ? "—"
                  : g.my_rating_diff < 0
                    ? `−${Math.abs(g.my_rating_diff)}`
                    : `+${g.my_rating_diff}`}
              </div>
            </Link>
          ))}

          <div className="flex items-center justify-between pt-6">
            <span className="kicker">
              {d.games.length} {d.games.length === 1 ? "entry" : "entries"}.
            </span>
            <span className="folio">page 7a</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="kicker" style={{ fontSize: 14 }}>
        {label}
      </span>
      <span
        className="font-display"
        style={{ fontSize: 18, fontWeight: 600 }}
      >
        {value}
      </span>
    </div>
  );
}

function BreakdownList({
  rows,
  fmt,
}: {
  rows: Array<{
    civ_slug: string;
    games: number;
    wins: number;
    losses: number;
    win_rate: number | null;
  }>;
  fmt: (slug: string) => string;
}) {
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li
          key={r.civ_slug}
          className="grid items-baseline gap-2"
          style={{ gridTemplateColumns: "1fr auto auto" }}
        >
          <span className="font-display" style={{ fontSize: 15 }}>
            {fmt(r.civ_slug)}
          </span>
          <span
            className="font-display text-[#5b574e]"
            style={{ fontSize: 13 }}
          >
            <span className="result-W">{r.wins}</span>–
            <span className="result-L">{r.losses}</span>
          </span>
          <span
            className="font-display text-right"
            style={{ fontSize: 13, minWidth: 36 }}
          >
            {fmtPct(r.win_rate)}
          </span>
        </li>
      ))}
    </ul>
  );
}

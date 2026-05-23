import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { api, qk, type Opponent } from "../lib/api.ts";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/index.ts";

const opponentsSearchSchema = z.object({
  q: z.string().optional(),
  sort: z.enum(["matches", "recent", "name"]).optional(),
});

export const Route = createFileRoute("/opponents/")({
  validateSearch: opponentsSearchSchema,
  component: OpponentsIndex,
});

function fmtDay(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })} ${d.getFullYear()}`;
}

function OpponentsIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const sort = search.sort ?? "matches";
  const [draft, setDraft] = useState(search.q ?? "");

  const params: Record<string, string> = { sort };
  if (search.q) params.search = search.q;
  const qs = new URLSearchParams(params).toString();

  const opponentsQ = useQuery({
    queryKey: qk.opponents({ q: search.q, sort }),
    queryFn: () =>
      api.get<{ opponents: Opponent[] }>(`/opponents?${qs}`),
  });

  const list = opponentsQ.data?.opponents ?? [];
  const totalGames = list.reduce((acc, o) => acc + o.games, 0);

  function submitSearch(e: React.FormEvent): void {
    e.preventDefault();
    const next = { ...search, q: draft.trim() || undefined };
    void navigate({ search: next });
  }

  function updateSort(value: "matches" | "recent" | "name"): void {
    void navigate({
      search: { ...search, sort: value === "matches" ? undefined : value },
    });
  }

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-4">
          <div className="eyebrow-tight pb-4">The Adversaries</div>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 60,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            On the
            <br />
            Opposing
            <br />
            Hand.
          </h2>
          <hr className="rule-gold my-5" />
          <p className="marginalia">
            Every player whose banner has stood opposite this one. Listed by
            frequency of engagement — the most often met, named first.
          </p>
          <hr className="rule-faint my-5" />
          <p className="kicker" style={{ fontSize: 14 }}>
            <span className="smallcaps text-[#5b574e]">By the figures</span> —{" "}
            {list.length} distinct opponents across {totalGames} contests.
          </p>

          <div className="mt-8 space-y-5">
            <form onSubmit={submitSearch}>
              <Label>Search by name</Label>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={submitSearch}
                placeholder="e.g. Beasty"
              />
            </form>

            <div>
              <Label>Sort by</Label>
              <Select
                value={sort}
                onValueChange={(v) =>
                  updateSort(v as "matches" | "recent" | "name")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matches">Matches played</SelectItem>
                  <SelectItem value="recent">Most recent</SelectItem>
                  <SelectItem value="name">Name (A–Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="col-span-8">
          <div
            className="grid items-baseline gap-4 pb-2"
            style={{
              gridTemplateColumns: "1fr 80px 100px 120px",
              borderBottom: "2px solid #1c1c1a",
            }}
          >
            <div className="eyebrow-tight">Opponent</div>
            <div className="eyebrow-tight text-right">Matches</div>
            <div className="eyebrow-tight text-right">W–L–D</div>
            <div className="eyebrow-tight text-right">Last met</div>
          </div>

          {opponentsQ.isLoading ? (
            <div className="kicker py-6">Reading the rolls…</div>
          ) : list.length === 0 ? (
            <div className="kicker py-6">
              {search.q
                ? `No opponents match "${search.q}".`
                : "No opponents on record."}
            </div>
          ) : (
            <ul>
              {list.map((o) => (
                <li
                  key={o.key}
                  className="border-b border-[rgba(28,28,26,0.1)]"
                >
                  <Link
                    to="/opponents/$key"
                    params={{ key: o.key }}
                    className="grid items-baseline gap-4 py-3 hover:bg-[rgba(28,28,26,0.04)]"
                    style={{ gridTemplateColumns: "1fr 80px 100px 120px" }}
                  >
                  <div
                    className="font-display"
                    style={{ fontSize: 19, fontWeight: 600 }}
                  >
                    {o.name}
                    {o.profile_id === null && (
                      <span
                        className="font-display italic text-[#5b574e] ml-2"
                        style={{ fontSize: 13 }}
                      >
                        (unlinked)
                      </span>
                    )}
                  </div>
                  <div
                    className="font-display text-right"
                    style={{ fontSize: 17, fontWeight: 500 }}
                  >
                    {o.games}
                  </div>
                  <div
                    className="font-display text-right"
                    style={{ fontSize: 15 }}
                  >
                    <span className="result-W">{o.wins}</span>
                    <span className="text-[#5b574e]">–</span>
                    <span className="result-L">{o.losses}</span>
                    {o.draws > 0 && (
                      <>
                        <span className="text-[#5b574e]">–</span>
                        <span className="result-D">{o.draws}</span>
                      </>
                    )}
                  </div>
                  <div
                    className="font-display italic text-right text-[#5b574e]"
                    style={{ fontSize: 14 }}
                  >
                    {fmtDay(o.last_played_at)}
                  </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between pt-6">
            <span className="kicker">
              {list.length} {list.length === 1 ? "entry" : "entries"} shown.
            </span>
            <span className="folio">page 7</span>
          </div>
        </div>
      </div>
    </section>
  );
}

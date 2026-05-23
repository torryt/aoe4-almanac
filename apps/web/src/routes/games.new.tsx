import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { KNIGHTS_TEMPLAR } from "@aoe4-almanac/shared";
import { api, qk, type Civ } from "../lib/api.ts";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "../components/ui/index.ts";

export const Route = createFileRoute("/games/new")({
  component: GameNew,
});

function GameNew() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const civs = civsQ.data?.civs ?? [];

  const [startedAtLocal, setStartedAtLocal] = useState<string>(
    new Date().toISOString().slice(0, 16),
  );
  const [myCiv, setMyCiv] = useState(KNIGHTS_TEMPLAR);
  const [oppCiv, setOppCiv] = useState("");
  const [oppName, setOppName] = useState("");
  const [result, setResult] = useState<"win" | "loss" | "draw">("win");
  const [map, setMap] = useState("");
  const [kind, setKind] = useState("custom");
  const [durationMin, setDurationMin] = useState("");
  const [notes, setNotes] = useState("");

  const submit = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ id: number }>("/games", body),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["games"] });
      void nav({ to: "/games/$gameId", params: { gameId: String(data.id) } });
    },
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const started_at = Math.floor(new Date(startedAtLocal).getTime() / 1000);
    const duration_seconds = durationMin ? Number(durationMin) * 60 : undefined;
    submit.mutate({
      started_at,
      my_civ_slug: myCiv,
      my_result: result,
      opp_civ_slug: oppCiv || undefined,
      opp_name: oppName || undefined,
      map_slug: map || undefined,
      kind,
      duration_seconds,
      notes: notes || undefined,
    });
  }

  return (
    <section className="spread px-10 pt-16 pb-20">
      <Link to="/games" className="nav-link inline-block mb-4">
        ← The Ledger
      </Link>
      <div className="flex items-center gap-4 pb-6">
        <span className="eyebrow">A Manual Entry</span>
        <hr className="rule-faint flex-1" />
        <span className="eyebrow">By the proprietor's hand</span>
      </div>

      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-4">
          <p className="kicker pb-2">A bound deposition.</p>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 60,
              lineHeight: 0.95,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Log a
            <br />
            campaign.
          </h2>
          <hr className="rule-gold my-5" />
          <p className="marginalia">
            For matches that lie outside the aoe4world ledger — customs,
            tournaments, friendly bouts — record the essentials here. The
            entry will appear alongside imported games in the Ledger and in
            matchup statistics.
          </p>
        </div>

        <form onSubmit={onSubmit} className="col-span-8 space-y-6">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <Label>Started at</Label>
              <Input
                type="datetime-local"
                required
                value={startedAtLocal}
                onChange={(e) => setStartedAtLocal(e.target.value)}
              />
            </div>
            <div>
              <Label>Result</Label>
              <Select
                value={result}
                onValueChange={(v) =>
                  setResult(v as "win" | "loss" | "draw")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="win">Victory</SelectItem>
                  <SelectItem value="loss">Defeat</SelectItem>
                  <SelectItem value="draw">Draw</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <Label>My civilisation</Label>
              <Select value={myCiv} onValueChange={setMyCiv}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
              <Label>Opponent civilisation</Label>
              <Select
                value={oppCiv || "__none"}
                onValueChange={(v) => setOppCiv(v === "__none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(none)</SelectItem>
                  {civs.map((c) => (
                    <SelectItem key={c.slug} value={c.slug}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <Label>Opponent name</Label>
              <Input
                type="text"
                value={oppName}
                onChange={(e) => setOppName(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div>
              <Label>Map</Label>
              <Input
                type="text"
                value={map}
                onChange={(e) => setMap(e.target.value)}
                placeholder="e.g. dry_arabia"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="rm_1v1">Ranked 1v1</SelectItem>
                  <SelectItem value="rm_2v2">Ranked 2v2</SelectItem>
                  <SelectItem value="qm_1v1">Quick 1v1</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                min={0}
                value={durationMin}
                onChange={(e) => setDurationMin(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>

          <div>
            <Label>Notes on the match</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              className="essay"
              placeholder="Optional notes on the campaign…"
            />
          </div>

          {submit.isError && (
            <p className="kicker text-[#9b2b2b]">
              {String((submit.error as Error)?.message ?? submit.error)}
            </p>
          )}

          <hr className="rule-faint" />

          <div className="flex gap-3">
            <Button variant="signet" disabled={submit.isPending} type="submit">
              {submit.isPending ? "Saving…" : "Bind Entry"}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => void nav({ to: "/games" })}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

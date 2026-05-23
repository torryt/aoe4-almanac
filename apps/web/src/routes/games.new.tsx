import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, qk, type Civ } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";

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
  const [myCiv, setMyCiv] = useState("templar");
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
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Log a manual game</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-4 text-sm">
          <Row label="Started at">
            <input
              type="datetime-local"
              required
              value={startedAtLocal}
              onChange={(e) => setStartedAtLocal(e.target.value)}
              className="rounded border border-stone-300 px-2 py-1"
            />
          </Row>
          <Row label="My civ">
            <select
              value={myCiv}
              onChange={(e) => setMyCiv(e.target.value)}
              className="w-full rounded border border-stone-300 px-2 py-1"
            >
              {civs.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Result">
            <select
              value={result}
              onChange={(e) =>
                setResult(e.target.value as "win" | "loss" | "draw")
              }
              className="rounded border border-stone-300 px-2 py-1"
            >
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="draw">Draw</option>
            </select>
          </Row>
          <Row label="Opponent civ">
            <select
              value={oppCiv}
              onChange={(e) => setOppCiv(e.target.value)}
              className="w-full rounded border border-stone-300 px-2 py-1"
            >
              <option value="">(none)</option>
              {civs.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Opponent name (optional)">
            <input
              type="text"
              value={oppName}
              onChange={(e) => setOppName(e.target.value)}
              className="w-full rounded border border-stone-300 px-2 py-1"
            />
          </Row>
          <Row label="Map (optional)">
            <input
              type="text"
              value={map}
              onChange={(e) => setMap(e.target.value)}
              placeholder="e.g. dry_arabia"
              className="w-full rounded border border-stone-300 px-2 py-1"
            />
          </Row>
          <Row label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded border border-stone-300 px-2 py-1"
            >
              <option value="custom">Custom</option>
              <option value="rm_1v1">Ranked 1v1</option>
              <option value="rm_2v2">Ranked 2v2</option>
              <option value="qm_1v1">Quick 1v1</option>
              <option value="manual">Manual</option>
            </select>
          </Row>
          <Row label="Duration (minutes, optional)">
            <input
              type="number"
              min={0}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              className="w-32 rounded border border-stone-300 px-2 py-1"
            />
          </Row>
          <Row label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="block w-full resize-y rounded border border-stone-300 px-2 py-1 font-mono text-xs"
              rows={4}
            />
          </Row>
          {submit.isError && (
            <div className="text-xs text-rose-700">
              {String((submit.error as Error)?.message ?? submit.error)}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submit.isPending}
              className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {submit.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => void nav({ to: "/games" })}
              className="rounded border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700"
            >
              Cancel
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-stone-500">{label}</span>
      {children}
    </label>
  );
}

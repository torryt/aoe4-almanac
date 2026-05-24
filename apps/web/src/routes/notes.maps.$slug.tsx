import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import { api, qk } from "../lib/api.ts";
import {
  autoSaveStatusLabel,
  useAutoSaveNote,
} from "../lib/useAutoSaveNote.ts";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../components/ui/index.ts";
import { prettyMap } from "./index.tsx";

export const Route = createFileRoute("/notes/maps/$slug")({
  component: MapNoteEditor,
});

function MapNoteEditor() {
  const { slug } = Route.useParams();
  const qc = useQueryClient();
  const noteQ = useQuery({
    queryKey: qk.mapNote(slug),
    queryFn: () =>
      api.get<{ body_md: string; updated_at: number | null }>(
        `/notes/maps/${slug}`,
      ),
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
  const myStats = (statsQ.data?.rows ?? []).find((r) => r.map_slug === slug);

  const save = useMutation({
    mutationFn: (body_md: string) =>
      api.put<{ ok: true }>(`/notes/maps/${slug}`, { body_md }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.mapNote(slug) });
      qc.invalidateQueries({ queryKey: qk.mapNotes });
    },
  });
  const auto = useAutoSaveNote({
    serverBody: noteQ.data?.body_md,
    isSaving: save.isPending,
    save: (body) => save.mutate(body),
  });
  const { draft, setDraft, dirty } = auto;

  return (
    <section className="spread px-10 pt-16 pb-20">
      <Link to="/notes/maps" className="nav-link inline-block mb-4">
        ← The Atlas
      </Link>
      <div className="flex items-center gap-4 pb-6">
        <span className="eyebrow">The Map Note</span>
        <hr className="rule-faint flex-1" />
      </div>

      <div className="grid grid-cols-12 gap-10">
        <article className="col-span-8">
          <p className="kicker pb-2">A study of ground.</p>
          <h2
            className="font-display text-[#1c1c1a]"
            style={{
              fontSize: 80,
              lineHeight: 0.92,
              fontWeight: 700,
              letterSpacing: "-0.025em",
            }}
          >
            {prettyMap(slug)}.
          </h2>

          <hr className="rule mt-8" />

          <Tabs defaultValue="write" className="pt-8">
            <div className="flex items-center justify-between pb-3">
              <div className="eyebrow-tight">The note</div>
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="read">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="write">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => auto.autoSaveEnabled && auto.flush()}
                rows={14}
                className="essay dropcap"
                placeholder={`Spawns, sacred sites, key timings on ${prettyMap(slug)}…`}
              />
            </TabsContent>
            <TabsContent value="read">
              <div className="prose-note">
                {draft.trim() ? (
                  <ReactMarkdown>{draft}</ReactMarkdown>
                ) : (
                  <span className="kicker">Nothing written yet.</span>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <hr className="rule-faint mt-6" />
          <div className="flex items-center justify-between pt-3">
            <span className="kicker" style={{ fontSize: 13 }}>
              {noteQ.data?.updated_at
                ? `Last revised ${relative(noteQ.data.updated_at)}`
                : "Unwritten"}
            </span>
            {auto.autoSaveEnabled ? (
              <span className="kicker italic" style={{ fontSize: 13 }}>
                {autoSaveStatusLabel(auto.status, !!noteQ.data?.updated_at)}
              </span>
            ) : (
              <Button
                variant="signet"
                size="sm"
                onClick={() => save.mutate(draft)}
                disabled={!dirty || save.isPending}
              >
                {save.isPending ? "Saving…" : dirty ? "Save Note" : "Saved"}
              </Button>
            )}
          </div>
        </article>

        <aside className="col-span-4 border-l border-[rgba(28,28,26,0.15)] pl-8">
          <div className="eyebrow-tight pb-4">My record here</div>
          {myStats ? (
            <>
              <div
                className="font-display"
                style={{ fontSize: 56, lineHeight: 1, fontWeight: 700 }}
              >
                {myStats.wins}
                <span className="text-[#5b574e] italic font-normal">–</span>
                {myStats.losses}
              </div>
              <p className="kicker pt-2">
                {myStats.win_rate !== null
                  ? `${(myStats.win_rate * 100).toFixed(1)}% across ${myStats.games} game${myStats.games === 1 ? "" : "s"}`
                  : `${myStats.games} game${myStats.games === 1 ? "" : "s"} on record`}
              </p>
            </>
          ) : (
            <p className="kicker">No games on this map yet.</p>
          )}

          <hr className="rule-faint my-5" />

          <div className="eyebrow-tight pb-3">Cross-references</div>
          <p
            className="font-display italic"
            style={{ fontSize: 14, lineHeight: 1.7, color: "#5b574e" }}
          >
            See also:{" "}
            <Link
              to="/games"
              search={{ map: slug }}
              className="not-italic text-[#1c1c1a] hover:underline"
            >
              all games on {prettyMap(slug)}
            </Link>
          </p>
        </aside>
      </div>
    </section>
  );
}

function relative(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

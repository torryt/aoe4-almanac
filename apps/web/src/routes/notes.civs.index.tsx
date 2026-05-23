import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { api, qk, type Civ } from "../lib/api.ts";
import { Card } from "../components/Card.tsx";
import { CivBadge } from "../components/CivBadge.tsx";

export const Route = createFileRoute("/notes/civs/")({
  component: CivNotesIndex,
});

function CivNotesIndex() {
  const civsQ = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const notesQ = useQuery({
    queryKey: qk.civNotes,
    queryFn: () =>
      api.get<{
        notes: Array<{ civ_slug: string; updated_at: number; excerpt: string }>;
      }>("/notes/civs"),
  });

  const notesByCiv = new Map(
    (notesQ.data?.notes ?? []).map((n) => [n.civ_slug, n]),
  );

  const baseCivs = (civsQ.data?.civs ?? []).filter((c) => !c.is_variant);
  const variantsByParent = new Map<string, Civ[]>();
  for (const c of civsQ.data?.civs ?? []) {
    if (c.is_variant && c.parent_slug) {
      const list = variantsByParent.get(c.parent_slug) ?? [];
      list.push(c);
      variantsByParent.set(c.parent_slug, list);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Civ notes</h1>
      <Card>
        <ul className="divide-y divide-stone-100">
          {baseCivs.map((c) => {
            const variants = variantsByParent.get(c.slug) ?? [];
            return (
              <li key={c.slug} className="py-2">
                <CivRow civ={c} note={notesByCiv.get(c.slug)} />
                {variants.length > 0 && (
                  <ul className="ml-6 mt-1 space-y-1 border-l border-stone-200 pl-3">
                    {variants.map((v) => (
                      <li key={v.slug}>
                        <CivRow civ={v} note={notesByCiv.get(v.slug)} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function CivRow({
  civ,
  note,
}: {
  civ: Civ;
  note: { excerpt: string; updated_at: number } | undefined;
}) {
  return (
    <Link
      to="/notes/civs/$slug"
      params={{ slug: civ.slug }}
      className="block rounded p-2 hover:bg-stone-50"
    >
      <div className="flex items-center gap-3">
        <CivBadge slug={civ.slug} name={civ.name} variant={civ.is_variant} />
        {note ? (
          <>
            <span className="flex-1 truncate text-xs text-stone-500">
              {note.excerpt || "(empty)"}
            </span>
            <span className="text-xs text-emerald-700">●</span>
          </>
        ) : (
          <span className="text-xs text-stone-400">no notes</span>
        )}
      </div>
    </Link>
  );
}

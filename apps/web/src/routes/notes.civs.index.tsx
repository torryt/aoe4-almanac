import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { KNIGHTS_TEMPLAR } from "@aoe4-almanac/shared";
import { api, qk, type Civ } from "../lib/api.ts";

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

  const noted = (notesQ.data?.notes ?? []).length;
  const total = (civsQ.data?.civs ?? []).length;

  return (
    <section className="spread px-10 pt-16 pb-20">
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-4">
          <div className="eyebrow-tight pb-4">The Roster</div>
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
            Standing
            <br />
            Civilisations.
          </h2>
          <hr className="rule-gold my-5" />
          <p className="marginalia">
            Each civilisation carries a general note — opening preferences,
            economic rhythm, signature units. Variants are recorded as fully
            distinct entries beneath their parent banner.
          </p>
          <hr className="rule-faint my-5" />
          <p className="kicker" style={{ fontSize: 14 }}>
            <span className="smallcaps text-[#5b574e]">By the figures</span> —{" "}
            {noted} of {total} entries have a standing note on file.
          </p>
        </div>

        <div className="col-span-8">
          <ul>
            {baseCivs.map((c) => {
              const variants = variantsByParent.get(c.slug) ?? [];
              return (
                <li
                  key={c.slug}
                  className="border-b border-[rgba(28,28,26,0.1)] py-3"
                >
                  <CivRow civ={c} note={notesByCiv.get(c.slug)} />
                  {variants.length > 0 && (
                    <ul className="ml-8 mt-2 border-l border-[rgba(28,28,26,0.15)] pl-4 space-y-2">
                      {variants.map((v) => (
                        <li key={v.slug}>
                          <CivRow
                            civ={v}
                            note={notesByCiv.get(v.slug)}
                            indent
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between pt-6">
            <span className="kicker">Variants indented beneath parent.</span>
            <span className="folio">page 5</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function CivRow({
  civ,
  note,
  indent = false,
}: {
  civ: Civ;
  note: { excerpt: string; updated_at: number } | undefined;
  indent?: boolean;
}) {
  const main = civ.slug === KNIGHTS_TEMPLAR;
  return (
    <Link
      to="/notes/civs/$slug"
      params={{ slug: civ.slug }}
      className="flex items-baseline gap-4 hover:bg-[rgba(28,28,26,0.04)] py-1"
    >
      <span
        className={`font-display ${main ? "text-[#9b2b2b]" : ""} ${indent ? "italic text-[#5b574e]" : ""}`}
        style={{
          fontSize: indent ? 16 : 19,
          fontWeight: main ? 700 : indent ? 500 : 600,
          minWidth: 200,
        }}
      >
        {civ.name}
      </span>
      <span
        className="font-display italic flex-1 truncate"
        style={{
          fontSize: 14,
          color: note ? "#5b574e" : "#9b2b2b",
        }}
      >
        {note
          ? note.excerpt || "(empty note)"
          : "No note — still to write"}
      </span>
      {note && (
        <span
          className="inline-block"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#9b2b2b",
          }}
        />
      )}
    </Link>
  );
}

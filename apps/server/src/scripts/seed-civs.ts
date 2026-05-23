import { sql } from "drizzle-orm";
import { VARIANT_PARENTS } from "@aoe4-almanac/shared";
import { db, sqlite } from "../db/client.ts";
import { civilizations, civSlugAliases, users } from "../db/schema.ts";

const CIVS_INDEX_URL =
  "https://raw.githubusercontent.com/aoe4world/data/main/civilizations/civs-index.json";

type RawCiv = {
  id?: string;
  slug?: string;
  name?: string;
  abbr?: string;
  attribName?: string;
  expansion?: string[];
  [k: string]: unknown;
};

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function fetchCivs(): Promise<RawCiv[]> {
  const res = await fetch(CIVS_INDEX_URL, {
    headers: { "user-agent": "aoe4-almanac-seed/0.1" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch civs-index.json: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as unknown;
  if (Array.isArray(json)) return json as RawCiv[];
  if (json && typeof json === "object") {
    const values = Object.values(json as Record<string, RawCiv>);
    if (values.every((v) => v && typeof v === "object")) return values;
  }
  throw new Error("civs-index.json: unrecognized shape");
}

function ensureLocalUser(): void {
  sqlite()
    .prepare(
      "INSERT INTO users (slug, display_name) VALUES ('local', 'Me') ON CONFLICT(slug) DO NOTHING",
    )
    .run();
}

async function main(): Promise<void> {
  ensureLocalUser();

  const raw = await fetchCivs();
  console.log(`Fetched ${raw.length} civ entries.`);

  let inserted = 0;
  for (const c of raw) {
    // Canonical slug is the long-form `id` (e.g. "knights_templar").
    // The short `slug` (e.g. "templar") and the abbreviation (e.g. "kt")
    // are registered as aliases so aoe4world payloads using them normalize
    // to the canonical form.
    const slug = pickStr(c.id) ?? pickStr(c.slug);
    const name = pickStr(c.name) ?? slug;
    if (!slug || !name) {
      console.warn("Skipping civ without id/name:", c);
      continue;
    }
    const parentSlug = VARIANT_PARENTS[slug] ?? null;
    const isVariant = parentSlug !== null;
    const flag = null;

    db()
      .insert(civilizations)
      .values({
        slug,
        name,
        parentSlug,
        isVariant,
        flagImageUrl: flag,
        dataJson: JSON.stringify(c),
      })
      .onConflictDoUpdate({
        target: civilizations.slug,
        set: {
          name,
          parentSlug,
          isVariant,
          flagImageUrl: flag,
          dataJson: JSON.stringify(c),
          updatedAt: sql`(unixepoch())`,
        },
      })
      .run();
    inserted += 1;

    const aliases = new Set<string>();
    const shortSlug = pickStr(c.slug);
    if (shortSlug && shortSlug !== slug) aliases.add(shortSlug);
    const abbr = pickStr(c.abbr);
    if (abbr && abbr !== slug) aliases.add(abbr);
    for (const alias of aliases) {
      db()
        .insert(civSlugAliases)
        .values({ alias, civSlug: slug })
        .onConflictDoUpdate({
          target: civSlugAliases.alias,
          set: { civSlug: slug },
        })
        .run();
    }
  }

  // Drop count
  const count = sqlite().prepare("SELECT COUNT(*) AS n FROM civilizations").get() as {
    n: number;
  };
  console.log(`Upserted ${inserted} civs. Table now holds ${count.n}.`);
  // Ensure user exists
  const u = db().select().from(users).all();
  console.log(`Users: ${u.length} (slug=${u.map((x) => x.slug).join(",")})`);
  sqlite().close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

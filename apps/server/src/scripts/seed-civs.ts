import { sql } from "drizzle-orm";
import { db, sqlite } from "../db/client.ts";
import { civilizations, users } from "../db/schema.ts";

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

// Variant -> parent slug. Curated; updates needed when new variants ship.
const VARIANT_PARENTS: Record<string, string> = {
  ayyubids: "abbasid",
  goldenhorde: "mongols",
  jeannedarc: "french",
  jindynasty: "chinese",
  lancaster: "english",
  macedonian: "byzantines",
  orderofthedragon: "hre",
  sengoku: "japanese",
  templar: "french",
  tughlaq: "delhi",
  zhuxi: "chinese",
};

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function fetchCivs(): Promise<RawCiv[]> {
  const res = await fetch(CIVS_INDEX_URL, {
    headers: { "user-agent": "aoe4-portal-seed/0.1" },
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
    const slug = pickStr(c.slug) ?? pickStr(c.id);
    const name = pickStr(c.name) ?? slug;
    if (!slug || !name) {
      console.warn("Skipping civ without slug/name:", c);
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

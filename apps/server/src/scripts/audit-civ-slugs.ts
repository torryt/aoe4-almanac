import { sqlite } from "../db/client.ts";

const db = sqlite();
const knownSlugs = new Set<string>(
  (db.prepare("SELECT slug FROM civilizations").all() as { slug: string }[]).map(
    (r) => r.slug,
  ),
);
const aliasMap = new Map<string, string>(
  (db.prepare("SELECT alias, civ_slug FROM civ_slug_aliases").all() as {
    alias: string;
    civ_slug: string;
  }[]).map((r) => [r.alias, r.civ_slug]),
);

const usedSlugs = (
  db.prepare("SELECT DISTINCT civ_slug FROM game_participants").all() as {
    civ_slug: string;
  }[]
).map((r) => r.civ_slug);

const unknown: string[] = [];
for (const slug of usedSlugs) {
  if (knownSlugs.has(slug)) continue;
  if (aliasMap.has(slug)) continue;
  unknown.push(slug);
}

if (unknown.length === 0) {
  console.log(`All ${usedSlugs.length} observed civ slugs are recognized.`);
} else {
  console.log(`Unknown civ slugs found in game_participants:`);
  for (const s of unknown) {
    console.log(`  - ${s}`);
  }
  console.log(
    `\nAdd these to civ_slug_aliases via SQL or a follow-up migration. Example:`,
  );
  for (const s of unknown) {
    console.log(
      `  INSERT INTO civ_slug_aliases (alias, civ_slug) VALUES ('${s}', '???');`,
    );
  }
}
db.close();

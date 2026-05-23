// One-off migration: rewrites short aoe4world slugs (e.g. "templar", "zhuxi",
// "hre") to canonical ids (e.g. "knights_templar", "zhu_xis_legacy",
// "holy_roman_empire") in every table that stores a civ slug. Idempotent —
// rerunning is a no-op once all rows are canonical.
//
// Run AFTER `seed-civs` so the canonical rows exist in civilizations.

import { SHORT_SLUG_TO_CANONICAL } from "@aoe4-almanac/shared";
import { sqlite } from "../db/client.ts";

const conn = sqlite();

const entries = Object.entries(SHORT_SLUG_TO_CANONICAL).filter(
  ([short, canonical]) => short !== canonical,
);

type RewriteTarget = { table: string; column: string };

const targets: RewriteTarget[] = [
  { table: "game_participants", column: "civ_slug" },
  { table: "games", column: "my_civ_slug" },
  { table: "civ_notes", column: "civ_slug" },
  { table: "matchup_notes", column: "my_civ_slug" },
  { table: "matchup_notes", column: "opp_civ_slug" },
  { table: "civ_slug_aliases", column: "civ_slug" },
];

// Merge bodies when a rewrite would collide on the unique index of a notes
// table. We append the alias row's body to the canonical row's body (separated
// by a horizontal rule) and then delete the alias row. Empty/whitespace-only
// bodies are dropped silently.
function mergeBodies(canonical: string, alias: string): string {
  const a = canonical.trim();
  const b = alias.trim();
  if (!b) return canonical;
  if (!a) return alias;
  if (a === b) return canonical;
  return `${canonical}\n\n---\n\n${alias}`;
}

const updateOne = conn.transaction(
  (table: string, column: string, fromSlug: string, toSlug: string) => {
    if (table === "matchup_notes") {
      const findDupSql =
        column === "my_civ_slug"
          ? `SELECT m1.id AS alias_id, m1.body_md AS alias_body, m2.id AS canon_id, m2.body_md AS canon_body
             FROM matchup_notes m1
             JOIN matchup_notes m2
               ON m2.user_id = m1.user_id
              AND m2.my_civ_slug = ?
              AND m2.opp_civ_slug = m1.opp_civ_slug
             WHERE m1.my_civ_slug = ?`
          : `SELECT m1.id AS alias_id, m1.body_md AS alias_body, m2.id AS canon_id, m2.body_md AS canon_body
             FROM matchup_notes m1
             JOIN matchup_notes m2
               ON m2.user_id = m1.user_id
              AND m2.my_civ_slug = m1.my_civ_slug
              AND m2.opp_civ_slug = ?
             WHERE m1.opp_civ_slug = ?`;
      const conflicts = conn.prepare(findDupSql).all(toSlug, fromSlug) as {
        alias_id: number;
        alias_body: string;
        canon_id: number;
        canon_body: string;
      }[];
      for (const c of conflicts) {
        const merged = mergeBodies(c.canon_body, c.alias_body);
        if (merged !== c.canon_body) {
          conn
            .prepare("UPDATE matchup_notes SET body_md = ?, updated_at = (unixepoch()) WHERE id = ?")
            .run(merged, c.canon_id);
          console.log(
            `  matchup_notes: merged body of #${c.alias_id} into #${c.canon_id}`,
          );
        }
        conn.prepare("DELETE FROM matchup_notes WHERE id = ?").run(c.alias_id);
      }
    } else if (table === "civ_notes" && column === "civ_slug") {
      const conflicts = conn
        .prepare(
          `SELECT c1.id AS alias_id, c1.body_md AS alias_body, c2.id AS canon_id, c2.body_md AS canon_body
           FROM civ_notes c1
           JOIN civ_notes c2 ON c2.user_id = c1.user_id AND c2.civ_slug = ?
           WHERE c1.civ_slug = ?`,
        )
        .all(toSlug, fromSlug) as {
        alias_id: number;
        alias_body: string;
        canon_id: number;
        canon_body: string;
      }[];
      for (const c of conflicts) {
        const merged = mergeBodies(c.canon_body, c.alias_body);
        if (merged !== c.canon_body) {
          conn
            .prepare("UPDATE civ_notes SET body_md = ?, updated_at = (unixepoch()) WHERE id = ?")
            .run(merged, c.canon_id);
          console.log(
            `  civ_notes: merged body of #${c.alias_id} into #${c.canon_id}`,
          );
        }
        conn.prepare("DELETE FROM civ_notes WHERE id = ?").run(c.alias_id);
      }
    }

    const info = conn
      .prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
      .run(toSlug, fromSlug);
    return info.changes;
  },
);

let totalChanges = 0;
for (const { table, column } of targets) {
  for (const [shortSlug, canonical] of entries) {
    const changes = updateOne(table, column, shortSlug, canonical);
    if (changes > 0) {
      console.log(`  ${table}.${column}: ${shortSlug} -> ${canonical} (${changes} row[s])`);
      totalChanges += changes;
    }
  }
}

// Rewrite civilizations table: rename short-slug rows to canonical, then drop
// duplicates if the canonical row already exists. Also fix parent_slug refs.
for (const [shortSlug, canonical] of entries) {
  const existsCanonical = conn
    .prepare("SELECT 1 FROM civilizations WHERE slug = ?")
    .get(canonical) as { 1: number } | undefined;
  const existsShort = conn
    .prepare("SELECT 1 FROM civilizations WHERE slug = ?")
    .get(shortSlug) as { 1: number } | undefined;
  if (existsShort && !existsCanonical) {
    const info = conn
      .prepare("UPDATE civilizations SET slug = ? WHERE slug = ?")
      .run(canonical, shortSlug);
    if (info.changes > 0) {
      console.log(`  civilizations.slug: ${shortSlug} -> ${canonical}`);
      totalChanges += info.changes;
    }
  } else if (existsShort && existsCanonical) {
    const info = conn
      .prepare("DELETE FROM civilizations WHERE slug = ?")
      .run(shortSlug);
    if (info.changes > 0) {
      console.log(`  civilizations: dropped duplicate ${shortSlug}`);
      totalChanges += info.changes;
    }
  }
  const parentInfo = conn
    .prepare(
      "UPDATE civilizations SET parent_slug = ? WHERE parent_slug = ?",
    )
    .run(canonical, shortSlug);
  if (parentInfo.changes > 0) {
    console.log(
      `  civilizations.parent_slug: ${shortSlug} -> ${canonical} (${parentInfo.changes})`,
    );
    totalChanges += parentInfo.changes;
  }
}

if (totalChanges === 0) {
  console.log("No short slugs found — already canonical.");
} else {
  console.log(`Done. Total row rewrites: ${totalChanges}`);
}

conn.close();

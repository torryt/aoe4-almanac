import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Point the db client at a fresh tmp file BEFORE importing anything that
// touches db()/sqlite() — those are module singletons.
const tmpDir = mkdtempSync(join(tmpdir(), "aoe4-almanac-test-"));
process.env.AOE4_ALMANAC_DB_PATH = join(tmpDir, "test.db");

const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
const { Hono } = await import("hono");
const { db, sqlite, closeDb } = await import("../db/client.ts");
const { users, matchupNotes } = await import("../db/schema.ts");
const { notesRoutes } = await import("./notes.ts");

const migrationsFolder = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "db",
  "migrations",
);

let userId: number;

beforeAll(() => {
  migrate(db(), { migrationsFolder });
  const info = sqlite()
    .prepare("INSERT INTO users (slug, display_name) VALUES (?, ?)")
    .run("test", "Test User");
  userId = Number(info.lastInsertRowid);
});

afterAll(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeApp() {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    await next();
  });
  app.route("/notes", notesRoutes);
  return app;
}

describe("GET /notes/matchups", () => {
  it("excludes notes with empty or whitespace-only bodies", async () => {
    sqlite().prepare("DELETE FROM matchup_notes").run();
    db()
      .insert(matchupNotes)
      .values([
        {
          userId,
          myCivSlug: "knights-templar",
          oppCivSlug: "chinese",
          bodyMd: "",
        },
        {
          userId,
          myCivSlug: "knights-templar",
          oppCivSlug: "mongols",
          bodyMd: "   \n  ",
        },
        {
          userId,
          myCivSlug: "knights-templar",
          oppCivSlug: "french",
          bodyMd: "Open with scouts, push Feudal early.",
        },
      ])
      .run();

    const res = await makeApp().request(
      "/notes/matchups?my_civ=knights-templar",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      notes: Array<{ opp_civ_slug: string }>;
    };
    const opps = body.notes.map((n) => n.opp_civ_slug).sort();
    expect(opps).toEqual(["french"]);
  });

  it("also applies the filter to the unfiltered listing", async () => {
    sqlite().prepare("DELETE FROM matchup_notes").run();
    db()
      .insert(matchupNotes)
      .values([
        { userId, myCivSlug: "english", oppCivSlug: "hre", bodyMd: "" },
        {
          userId,
          myCivSlug: "english",
          oppCivSlug: "rus",
          bodyMd: "Tower rush.",
        },
      ])
      .run();

    const res = await makeApp().request("/notes/matchups");
    const body = (await res.json()) as {
      notes: Array<{ opp_civ_slug: string }>;
    };
    expect(body.notes.map((n) => n.opp_civ_slug)).toEqual(["rus"]);
  });
});

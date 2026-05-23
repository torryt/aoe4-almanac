import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "../db/client.ts";
import { resolveDbPath } from "../env.ts";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, "..", "db", "migrations");

console.log(`Applying migrations from ${migrationsFolder}`);
console.log(`Database: ${resolveDbPath()}`);

migrate(db(), { migrationsFolder });
sqlite().close();
console.log("Migrations applied.");

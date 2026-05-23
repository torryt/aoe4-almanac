import { defineConfig } from "drizzle-kit";
import { resolveDbPath } from "./src/env.ts";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: resolveDbPath(),
  },
  verbose: true,
  strict: true,
});

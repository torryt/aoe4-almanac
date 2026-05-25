import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Each test sets AOE4_ALMANAC_DB_PATH and re-imports modules, so files
    // must not share the module registry.
    isolate: true,
    pool: "forks",
  },
});

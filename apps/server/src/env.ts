import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  AOE4_ALMANAC_DB_PATH: z.string().optional(),
  AOE4_ALMANAC_USER_AGENT: z
    .string()
    .default("aoe4-almanac/0.1 (local; +https://github.com/torry/aoe4-almanac)"),
  AOE4_ALMANAC_WEB_DIST: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}

export function resolveDbPath(): string {
  const fromEnv = process.env.AOE4_ALMANAC_DB_PATH;
  const path = fromEnv
    ? resolve(fromEnv.replace(/^~/, homedir()))
    : resolve(homedir(), ".aoe4-almanac", "data.db");
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

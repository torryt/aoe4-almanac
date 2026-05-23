import { sqlite } from "../db/client.ts";

// Lazily-loaded slug alias cache
let aliasCache: Map<string, string> | undefined;
let knownCivCache: Set<string> | undefined;

function loadAliases(): Map<string, string> {
  if (aliasCache) return aliasCache;
  const rows = sqlite()
    .prepare("SELECT alias, civ_slug FROM civ_slug_aliases")
    .all() as { alias: string; civ_slug: string }[];
  aliasCache = new Map(rows.map((r) => [r.alias, r.civ_slug]));
  return aliasCache;
}

function loadKnownCivs(): Set<string> {
  if (knownCivCache) return knownCivCache;
  const rows = sqlite()
    .prepare("SELECT slug FROM civilizations")
    .all() as { slug: string }[];
  knownCivCache = new Set(rows.map((r) => r.slug));
  return knownCivCache;
}

export function invalidateNormalizationCaches(): void {
  aliasCache = undefined;
  knownCivCache = undefined;
}

export function normalizeCivSlug(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase().trim().replace(/\s+/g, "_");
  const known = loadKnownCivs();
  if (known.has(lower)) return lower;
  const aliases = loadAliases();
  const aliased = aliases.get(lower) ?? aliases.get(raw);
  if (aliased) return aliased;
  return lower; // unknown — surfaced by audit-civ-slugs script
}

export function normalizeMapSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.toLowerCase().trim().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeResult(
  raw: string | null | undefined,
): "win" | "loss" | "draw" | "unknown" {
  if (raw === "win" || raw === "loss") return raw;
  if (raw === "draw") return "draw";
  return "unknown";
}

export function normalizeKind(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  return raw.toLowerCase().trim();
}

export function isoToUnix(iso: string | null | undefined): number {
  if (!iso) return Math.floor(Date.now() / 1000);
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Math.floor(Date.now() / 1000);
  return Math.floor(t / 1000);
}

export function ensureMap(slug: string | null, name: string | null): void {
  if (!slug) return;
  sqlite()
    .prepare(
      "INSERT INTO maps (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO NOTHING",
    )
    .run(slug, name ?? slug);
}

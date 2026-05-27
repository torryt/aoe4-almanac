import JSZip from "jszip";
import { api } from "./api.ts";

export const FORMAT_ID = "aoe4-almanac-notes";
export const SCHEMA_VERSION = 1;
export const MERGE_DELIMITER = "===============";

export type CivNote = {
  civ_slug: string;
  body_md: string;
  created_at: number;
  updated_at: number;
};
export type MatchupNote = {
  my_civ_slug: string;
  opp_civ_slug: string;
  body_md: string;
  created_at: number;
  updated_at: number;
};
export type MapNote = {
  map_slug: string;
  body_md: string;
  created_at: number;
  updated_at: number;
};
export type GameNote = {
  game_id: number;
  body_md: string;
  created_at: number;
  updated_at: number;
};

export type NotesBundle = {
  civ: CivNote[];
  matchup: MatchupNote[];
  map: MapNote[];
  game: GameNote[];
};

export type ExportPayload = {
  format: typeof FORMAT_ID;
  schema_version: number;
  exported_at: string;
  notes: NotesBundle;
};

export type ConflictStrategy = "merge" | "newest" | "skip";

type Conflict<T> = { incoming: T; existing: T };

export type Conflicts = {
  civ: Array<Conflict<CivNote>>;
  matchup: Array<Conflict<MatchupNote>>;
  map: Array<Conflict<MapNote>>;
  game: Array<Conflict<GameNote>>;
  total: number;
};

export async function fetchAllNotes(): Promise<NotesBundle> {
  return await api.get<NotesBundle>("/notes/export");
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the webview a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportAsJson(): Promise<void> {
  const notes = await fetchAllNotes();
  const payload: ExportPayload = {
    format: FORMAT_ID,
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    notes,
  };
  const json = JSON.stringify(payload, null, 2);
  triggerDownload(
    new Blob([json], { type: "application/json" }),
    `aoe4-almanac-notes_${timestamp()}.json`,
  );
}

function safeSlug(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, "_");
}

const README_TEXT =
  "AOE4 Almanac — notes export (markdown bundle)\n" +
  "=============================================\n" +
  "\n" +
  "This zip contains your notes as plain markdown, organised in folders by\n" +
  "kind: civs/, matchups/, maps/, games/.\n" +
  "\n" +
  "NOTE: This markdown bundle is for reading and external use only — it\n" +
  "cannot be re-imported. To round-trip your notes back into the Almanac,\n" +
  "use the JSON export option instead.\n";

export async function exportAsMarkdownZip(): Promise<void> {
  const notes = await fetchAllNotes();
  const zip = new JSZip();
  zip.file("README.txt", README_TEXT);

  const civs = zip.folder("civs");
  for (const n of notes.civ) {
    civs?.file(`${safeSlug(n.civ_slug)}.md`, n.body_md);
  }
  const matchups = zip.folder("matchups");
  for (const n of notes.matchup) {
    matchups?.file(
      `${safeSlug(n.my_civ_slug)}_vs_${safeSlug(n.opp_civ_slug)}.md`,
      n.body_md,
    );
  }
  const maps = zip.folder("maps");
  for (const n of notes.map) {
    maps?.file(`${safeSlug(n.map_slug)}.md`, n.body_md);
  }
  const games = zip.folder("games");
  for (const n of notes.game) {
    games?.file(`game_${n.game_id}.md`, n.body_md);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `aoe4-almanac-notes_${timestamp()}.zip`);
}

export class ImportFormatError extends Error {}

export async function readImportFile(file: File): Promise<ExportPayload> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ImportFormatError(
      `Not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new ImportFormatError("File does not contain a JSON object.");
  }
  const p = parsed as Partial<ExportPayload>;
  if (p.format !== FORMAT_ID) {
    throw new ImportFormatError(
      `Not an Almanac notes export (expected format "${FORMAT_ID}", got "${String(p.format)}").`,
    );
  }
  if (typeof p.schema_version !== "number") {
    throw new ImportFormatError("Missing schema_version.");
  }
  if (p.schema_version > SCHEMA_VERSION) {
    throw new ImportFormatError(
      `Schema version ${p.schema_version} is newer than this app supports (max ${SCHEMA_VERSION}). Please update the app.`,
    );
  }
  const notes = p.notes;
  if (
    !notes ||
    typeof notes !== "object" ||
    !Array.isArray((notes as NotesBundle).civ) ||
    !Array.isArray((notes as NotesBundle).matchup) ||
    !Array.isArray((notes as NotesBundle).map) ||
    !Array.isArray((notes as NotesBundle).game)
  ) {
    throw new ImportFormatError("notes section is missing or malformed.");
  }
  return p as ExportPayload;
}

function isContentConflict(a: string, b: string): boolean {
  return a.trim() !== b.trim();
}

export function detectConflicts(
  current: NotesBundle,
  incoming: NotesBundle,
): Conflicts {
  const out: Conflicts = {
    civ: [],
    matchup: [],
    map: [],
    game: [],
    total: 0,
  };

  const curCiv = new Map(current.civ.map((n) => [n.civ_slug, n]));
  for (const n of incoming.civ) {
    const ex = curCiv.get(n.civ_slug);
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      out.civ.push({ incoming: n, existing: ex });
    }
  }

  const curMatch = new Map(
    current.matchup.map((n) => [`${n.my_civ_slug}|${n.opp_civ_slug}`, n]),
  );
  for (const n of incoming.matchup) {
    const ex = curMatch.get(`${n.my_civ_slug}|${n.opp_civ_slug}`);
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      out.matchup.push({ incoming: n, existing: ex });
    }
  }

  const curMap = new Map(current.map.map((n) => [n.map_slug, n]));
  for (const n of incoming.map) {
    const ex = curMap.get(n.map_slug);
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      out.map.push({ incoming: n, existing: ex });
    }
  }

  const curGame = new Map(current.game.map((n) => [n.game_id, n]));
  for (const n of incoming.game) {
    const ex = curGame.get(n.game_id);
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      out.game.push({ incoming: n, existing: ex });
    }
  }

  out.total =
    out.civ.length + out.matchup.length + out.map.length + out.game.length;
  return out;
}

function mergeBodies(existing: string, incoming: string): string {
  return `${existing.trimEnd()}\n\n${MERGE_DELIMITER}\n\n${incoming.trimStart()}`;
}

function resolveBody(
  existing: string,
  existingUpdated: number,
  incoming: string,
  incomingUpdated: number,
  strategy: ConflictStrategy,
): string | null {
  switch (strategy) {
    case "merge":
      return mergeBodies(existing, incoming);
    case "newest":
      return incomingUpdated > existingUpdated ? incoming : existing;
    case "skip":
      return null;
  }
}

export type ImportResult = {
  written: number;
  skipped: number;
  failed: number;
  failures: string[];
};

export async function applyImport(
  current: NotesBundle,
  incoming: NotesBundle,
  strategy: ConflictStrategy,
): Promise<ImportResult> {
  const result: ImportResult = {
    written: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const curCiv = new Map(current.civ.map((n) => [n.civ_slug, n]));
  for (const n of incoming.civ) {
    const ex = curCiv.get(n.civ_slug);
    let body: string | null = n.body_md;
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      body = resolveBody(ex.body_md, ex.updated_at, n.body_md, n.updated_at, strategy);
    }
    if (body === null) {
      result.skipped++;
      continue;
    }
    try {
      await api.put(`/notes/civs/${encodeURIComponent(n.civ_slug)}`, { body_md: body });
      result.written++;
    } catch (e) {
      result.failed++;
      result.failures.push(`civ ${n.civ_slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const curMatch = new Map(
    current.matchup.map((n) => [`${n.my_civ_slug}|${n.opp_civ_slug}`, n]),
  );
  for (const n of incoming.matchup) {
    const ex = curMatch.get(`${n.my_civ_slug}|${n.opp_civ_slug}`);
    let body: string | null = n.body_md;
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      body = resolveBody(ex.body_md, ex.updated_at, n.body_md, n.updated_at, strategy);
    }
    if (body === null) {
      result.skipped++;
      continue;
    }
    try {
      await api.put(
        `/notes/matchups/${encodeURIComponent(n.my_civ_slug)}/${encodeURIComponent(n.opp_civ_slug)}`,
        { body_md: body },
      );
      result.written++;
    } catch (e) {
      result.failed++;
      result.failures.push(
        `matchup ${n.my_civ_slug} vs ${n.opp_civ_slug}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const curMap = new Map(current.map.map((n) => [n.map_slug, n]));
  for (const n of incoming.map) {
    const ex = curMap.get(n.map_slug);
    let body: string | null = n.body_md;
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      body = resolveBody(ex.body_md, ex.updated_at, n.body_md, n.updated_at, strategy);
    }
    if (body === null) {
      result.skipped++;
      continue;
    }
    try {
      await api.put(`/notes/maps/${encodeURIComponent(n.map_slug)}`, { body_md: body });
      result.written++;
    } catch (e) {
      result.failed++;
      result.failures.push(`map ${n.map_slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const curGame = new Map(current.game.map((n) => [n.game_id, n]));
  for (const n of incoming.game) {
    const ex = curGame.get(n.game_id);
    let body: string | null = n.body_md;
    if (ex && isContentConflict(ex.body_md, n.body_md)) {
      body = resolveBody(ex.body_md, ex.updated_at, n.body_md, n.updated_at, strategy);
    }
    if (body === null) {
      result.skipped++;
      continue;
    }
    try {
      await api.put(`/notes/games/${n.game_id}`, { body_md: body });
      result.written++;
    } catch (e) {
      // Most likely: game id not present locally (different aoe4world profile).
      result.failed++;
      result.failures.push(`game ${n.game_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

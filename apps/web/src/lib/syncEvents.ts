import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateGameDataCache, qk } from "./api.ts";

export type SyncEvent =
  | { type: "hello"; in_flight: boolean }
  | {
      type: "sync.started";
      user_id: number;
      profile_id: number;
      full: boolean;
      ts: number;
    }
  | {
      type: "sync.page";
      user_id: number;
      page: number;
      games_in_page: number;
      imported_so_far: number;
      scanned_so_far: number;
      total_count: number | null;
      full: boolean;
      ts: number;
    }
  | {
      type: "sync.completed";
      user_id: number;
      imported: number;
      last_seen_game_id: number | null;
      duration_ms: number;
      ts: number;
    }
  | { type: "sync.error"; user_id: number; message: string; ts: number };

export type SyncProgress =
  | { phase: "idle" }
  | { phase: "running"; scanned: number; imported: number; total: number | null }
  | { phase: "done"; imported: number; durationMs: number; ts: number }
  | { phase: "error"; message: string; ts: number };

// Subscribes to the server's sync event stream and reduces it into a small
// view-model. Also invalidates relevant React Query caches when a sync ends.
export function useSyncEvents(enabled: boolean): SyncProgress {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<SyncProgress>({ phase: "idle" });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/v1/sync/events");
    esRef.current = es;

    const onStarted = (): void => {
      setProgress({ phase: "running", scanned: 0, imported: 0, total: null });
    };
    const onPage = (ev: MessageEvent): void => {
      const data = JSON.parse(ev.data) as SyncEvent;
      if (data.type !== "sync.page") return;
      setProgress({
        phase: "running",
        scanned: data.scanned_so_far,
        imported: data.imported_so_far,
        total: data.total_count,
      });
    };
    const onCompleted = (ev: MessageEvent): void => {
      const data = JSON.parse(ev.data) as SyncEvent;
      if (data.type !== "sync.completed") return;
      setProgress({
        phase: "done",
        imported: data.imported,
        durationMs: data.duration_ms,
        ts: data.ts,
      });
      void qc.invalidateQueries({ queryKey: qk.syncStatus });
      // Always invalidate: even when no new games were imported, the most
      // recent few rows may have been refreshed (e.g. result going from
      // unknown→win once aoe4world finalized the game).
      invalidateGameDataCache(qc);
    };
    const onError = (ev: MessageEvent): void => {
      const data = JSON.parse(ev.data) as SyncEvent;
      if (data.type !== "sync.error") return;
      setProgress({ phase: "error", message: data.message, ts: data.ts });
      void qc.invalidateQueries({ queryKey: qk.syncStatus });
    };

    es.addEventListener("sync.started", onStarted);
    es.addEventListener("sync.page", onPage);
    es.addEventListener("sync.completed", onCompleted);
    es.addEventListener("sync.error", onError);

    return () => {
      es.removeEventListener("sync.started", onStarted);
      es.removeEventListener("sync.page", onPage);
      es.removeEventListener("sync.completed", onCompleted);
      es.removeEventListener("sync.error", onError);
      es.close();
      esRef.current = null;
    };
  }, [enabled, qc]);

  return progress;
}

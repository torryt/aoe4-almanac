import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateGameDataCache, qk } from "./api.ts";
import { eventBus } from "./transport/index.ts";

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

  useEffect(() => {
    if (!enabled) return;
    return eventBus.subscribeSync((data) => {
      if (data.type === "sync.started") {
        setProgress({ phase: "running", scanned: 0, imported: 0, total: null });
      } else if (data.type === "sync.page") {
        setProgress({
          phase: "running",
          scanned: data.scanned_so_far,
          imported: data.imported_so_far,
          total: data.total_count,
        });
      } else if (data.type === "sync.completed") {
        setProgress({
          phase: "done",
          imported: data.imported,
          durationMs: data.duration_ms,
          ts: data.ts,
        });
        void qc.invalidateQueries({ queryKey: qk.syncStatus });
        invalidateGameDataCache(qc);
      } else if (data.type === "sync.error") {
        setProgress({ phase: "error", message: data.message, ts: data.ts });
        void qc.invalidateQueries({ queryKey: qk.syncStatus });
      }
    });
  }, [enabled, qc]);

  return progress;
}

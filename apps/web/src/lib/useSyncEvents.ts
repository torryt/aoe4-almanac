import { useEffect, useState } from "react";

export type SyncEvent =
  | {
      type: "link.player_fetched";
      user_id: number;
      profile_id: number;
      display_name: string;
      ts: number;
    }
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
  | {
      type: "sync.error";
      user_id: number;
      message: string;
      ts: number;
    };

export type SyncProgress = {
  active: boolean;
  page: number;
  games_in_page: number;
  imported_so_far: number;
  scanned_so_far: number;
  total_count: number | null;
  display_name: string | null;
  full: boolean;
  started_at: number | null;
  last_event: SyncEvent | null;
  error: string | null;
  completed?: { imported: number; duration_ms: number; last_seen_game_id: number | null } | null;
};

const initial: SyncProgress = {
  active: false,
  page: 0,
  games_in_page: 0,
  imported_so_far: 0,
  scanned_so_far: 0,
  total_count: null,
  display_name: null,
  full: false,
  started_at: null,
  last_event: null,
  error: null,
  completed: null,
};

export function useSyncEvents(): SyncProgress {
  const [state, setState] = useState<SyncProgress>(initial);

  useEffect(() => {
    const es = new EventSource("/api/v1/sync/events");

    function applyEvent(e: SyncEvent): void {
      setState((prev) => {
        const next = { ...prev, last_event: e };
        if (e.type === "link.player_fetched") {
          next.display_name = e.display_name;
        } else if (e.type === "sync.started") {
          next.active = true;
          next.error = null;
          next.completed = null;
          next.full = e.full;
          next.imported_so_far = 0;
          next.scanned_so_far = 0;
          next.total_count = null;
          next.page = 0;
          next.games_in_page = 0;
          next.started_at = Date.now();
        } else if (e.type === "sync.page") {
          next.active = true;
          next.page = e.page;
          next.games_in_page = e.games_in_page;
          next.imported_so_far = e.imported_so_far;
          next.scanned_so_far = e.scanned_so_far;
          next.total_count = e.total_count;
          next.full = e.full;
        } else if (e.type === "sync.completed") {
          next.active = false;
          next.completed = {
            imported: e.imported,
            duration_ms: e.duration_ms,
            last_seen_game_id: e.last_seen_game_id,
          };
        } else if (e.type === "sync.error") {
          next.active = false;
          next.error = e.message;
        }
        return next;
      });
    }

    for (const t of [
      "link.player_fetched",
      "sync.started",
      "sync.page",
      "sync.completed",
      "sync.error",
    ] as const) {
      es.addEventListener(t, (ev) => {
        try {
          applyEvent(JSON.parse((ev as MessageEvent).data) as SyncEvent);
        } catch {
          // ignore malformed
        }
      });
    }

    return () => es.close();
  }, []);

  return state;
}

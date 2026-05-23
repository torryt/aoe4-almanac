// In-process pub/sub for sync progress. Consumed by the SSE endpoint.

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

type Handler = (e: SyncEvent) => void;
const subscribers = new Set<Handler>();

export function subscribeSync(handler: Handler): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

export function emitSync(event: SyncEvent): void {
  for (const h of subscribers) {
    try {
      h(event);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("sync subscriber threw:", e);
    }
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Transport {
  request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
}

export class TransportError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    public reqId: string | null,
  ) {
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    const idStr = reqId ? ` [reqId=${reqId}]` : "";
    super(`API ${status}${idStr}: ${bodyStr}`);
  }
}

export type SyncEventPayload =
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

export type Unsubscribe = () => void;

export interface EventBus {
  subscribeSync(handler: (event: SyncEventPayload) => void): Unsubscribe;
}

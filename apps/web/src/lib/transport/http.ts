import type { EventBus, HttpMethod, SyncEventPayload, Transport, Unsubscribe } from "./types.ts";
import { TransportError } from "./types.ts";

const BASE = "/api/v1";

function newReqId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2);
  return uuid.replace(/-/g, "").slice(0, 8);
}

export const httpTransport: Transport = {
  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
    const reqId = newReqId();
    const init: RequestInit = {
      method,
      headers: {
        "content-type": "application/json",
        "x-request-id": reqId,
      },
    };
    if (body !== undefined && method !== "GET" && method !== "DELETE") {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, init);
    const serverReqId = res.headers.get("x-request-id") ?? reqId;
    if (!res.ok) {
      let respBody: unknown = undefined;
      try {
        respBody = await res.json();
      } catch {
        respBody = await res.text();
      }
      throw new TransportError(res.status, respBody, serverReqId);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  },
};

export const httpEventBus: EventBus = {
  subscribeSync(handler: (event: SyncEventPayload) => void): Unsubscribe {
    const es = new EventSource(`${BASE}/sync/events`);
    const handle = (ev: MessageEvent): void => {
      try {
        handler(JSON.parse(ev.data) as SyncEventPayload);
      } catch {
        // ignore malformed events
      }
    };
    const names = [
      "link.player_fetched",
      "sync.started",
      "sync.page",
      "sync.completed",
      "sync.error",
    ];
    for (const n of names) es.addEventListener(n, handle as EventListener);
    es.onmessage = handle;
    return () => {
      for (const n of names) es.removeEventListener(n, handle as EventListener);
      es.close();
    };
  },
};

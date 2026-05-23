import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { syncRunBodySchema } from "@aoe4-portal/shared";
import type { AppContext } from "../auth/middleware.ts";
import { isSyncRunning, listSyncState, runSync } from "../services/sync.ts";
import { subscribeSync, type SyncEvent } from "../services/syncEvents.ts";

export const syncRoutes = new Hono<AppContext>();

syncRoutes.post("/run", zValidator("json", syncRunBodySchema), async (c) => {
  const userId = c.get("userId");
  const reqId = c.get("reqId");
  const { full } = c.req.valid("json");
  runSync(userId, full ?? false, { reqId }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[req ${reqId}] sync failed:`, e);
  });
  return c.json({ ok: true });
});

syncRoutes.get("/status", (c) => {
  const userId = c.get("userId");
  const rows = listSyncState(userId);
  return c.json({
    rows: rows.map((r) => ({
      leaderboard: r.leaderboard,
      last_seen_game_id: r.lastSeenGameId,
      last_polled_at: r.lastPolledAt,
      last_success_at: r.lastSuccessAt,
      last_error: r.lastError,
    })),
    in_flight: isSyncRunning(userId),
  });
});

syncRoutes.get("/events", (c) => {
  const userId = c.get("userId");
  return streamSSE(c, async (stream) => {
    let eventId = 0;

    const handler = (e: SyncEvent): void => {
      if (e.user_id !== userId) return;
      eventId += 1;
      void stream.writeSSE({
        id: String(eventId),
        event: e.type,
        data: JSON.stringify(e),
      });
    };
    const unsubscribe = subscribeSync(handler);

    // Send a hello so clients know the stream is open.
    await stream.writeSSE({
      event: "hello",
      data: JSON.stringify({ in_flight: isSyncRunning(userId) }),
    });

    // Heartbeat every 15s so reverse proxies / fetch keepalives don't drop us.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }, 15_000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Block until aborted.
    await new Promise<void>(() => {
      // never resolves; cleanup runs in onAbort
    });
  });
});

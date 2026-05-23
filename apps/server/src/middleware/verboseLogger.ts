import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../auth/middleware.ts";
import { log, logError } from "../log.ts";

declare module "hono" {
  interface ContextVariableMap {
    reqId: string;
  }
}

const TRUNC = 240;

function trunc(s: string): string {
  return s.length > TRUNC ? `${s.slice(0, TRUNC)}…(+${s.length - TRUNC})` : s;
}

function sanitizeReqId(raw: string | undefined): string | null {
  if (!raw) return null;
  // Accept short ascii alphanumerics + dashes; cap length.
  const trimmed = raw.trim().slice(0, 64);
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

export function verboseLogger(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const incoming = sanitizeReqId(c.req.header("x-request-id"));
    const reqId = incoming ?? randomUUID().slice(0, 8);
    c.set("reqId", reqId);
    c.header("x-request-id", reqId);

    const start = performance.now();
    const method = c.req.method;
    const path = c.req.path;
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";

    let bodyPreview = "";
    if (path.startsWith("/api/") && method !== "GET" && method !== "HEAD") {
      try {
        const raw = await c.req.raw.clone().text();
        bodyPreview = raw ? ` body=${trunc(raw)}` : "";
      } catch {
        bodyPreview = "";
      }
    }

    log(reqId, `→ ${method} ${path}${qs}${bodyPreview}`);

    try {
      await next();
      const ms = performance.now() - start;
      const status = c.res.status;
      log(reqId, `← ${status} ${ms.toFixed(1)}ms ${method} ${path}`);
    } catch (e) {
      const ms = performance.now() - start;
      logError(
        reqId,
        `✗ ${ms.toFixed(1)}ms ${method} ${path} err=${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  };
}

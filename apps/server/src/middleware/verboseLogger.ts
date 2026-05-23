import { randomUUID } from "node:crypto";
import { SpanStatusCode } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../auth/middleware.ts";
import { tracer } from "../telemetry.ts";

declare module "hono" {
  interface ContextVariableMap {
    reqId: string;
  }
}

const TRUNC = 240;

function trunc(s: string): string {
  return s.length > TRUNC ? `${s.slice(0, TRUNC)}…(+${s.length - TRUNC})` : s;
}

export function verboseLogger(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const reqId = randomUUID().slice(0, 8);
    c.set("reqId", reqId);
    const start = performance.now();
    const method = c.req.method;
    const path = c.req.path;
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";

    // Capture body for mutating requests on the API.
    let bodyPreview = "";
    if (path.startsWith("/api/") && method !== "GET" && method !== "HEAD") {
      try {
        const raw = await c.req.raw.clone().text();
        bodyPreview = raw ? ` body=${trunc(raw)}` : "";
      } catch {
        bodyPreview = "";
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[req ${reqId}] → ${method} ${path}${qs}${bodyPreview}`);

    await tracer.startActiveSpan(
      `${method} ${path}`,
      {
        attributes: {
          "http.request.method": method,
          "url.path": path,
          "req.id": reqId,
        },
      },
      async (span) => {
        try {
          await next();
          const ms = performance.now() - start;
          const status = c.res.status;
          span.setAttribute("http.response.status_code", status);
          if (status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: `status ${status}` });
          }
          // eslint-disable-next-line no-console
          console.log(`[req ${reqId}] ← ${status} ${ms.toFixed(1)}ms ${method} ${path}`);
        } catch (e) {
          const ms = performance.now() - start;
          span.recordException(e as Error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: e instanceof Error ? e.message : String(e),
          });
          // eslint-disable-next-line no-console
          console.log(
            `[req ${reqId}] ✗ ${ms.toFixed(1)}ms ${method} ${path}  err=${e instanceof Error ? e.message : String(e)}`,
          );
          throw e;
        } finally {
          span.end();
        }
      },
    );
  };
}

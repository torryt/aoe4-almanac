import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Compact one-line console exporter. Emits when each span ends.
class CompactConsoleExporter implements SpanExporter {
  export(spans: ReadableSpan[], cb: (result: { code: 0 | 1 }) => void): void {
    for (const s of spans) {
      const ms = hrToMs(s.endTime) - hrToMs(s.startTime);
      const trc = s.spanContext().traceId.slice(0, 8);
      const sp = s.spanContext().spanId.slice(0, 6);
      const parent = s.parentSpanContext?.spanId?.slice(0, 6) ?? "------";
      const attrParts: string[] = [];
      for (const [k, v] of Object.entries(s.attributes)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("http.request.header") || k.startsWith("http.response.header")) continue;
        attrParts.push(`${k}=${formatVal(v)}`);
      }
      if (s.status?.code === 2) attrParts.push(`error=${JSON.stringify(s.status.message ?? "")}`);
      // eslint-disable-next-line no-console
      console.log(
        `[otel ${trc} ${sp} <-${parent}] ${ms.toFixed(1).padStart(7)}ms  ${s.name}${attrParts.length ? "  " + attrParts.join(" ") : ""}`,
      );
    }
    cb({ code: 0 });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function hrToMs(t: [number, number]): number {
  return t[0] * 1000 + t[1] / 1e6;
}

function formatVal(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(formatVal).join(",")}]`;
  if (typeof v === "string") {
    if (v.length > 80) return JSON.stringify(v.slice(0, 77) + "...");
    return /^\w+$/.test(v) ? v : JSON.stringify(v);
  }
  return String(v);
}

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "aoe4-portal-server" }),
  spanProcessors: [new SimpleSpanProcessor(new CompactConsoleExporter())],
});
provider.register();

export const tracer = trace.getTracer("aoe4-portal");

// Re-export so call sites don't need a separate @opentelemetry/api import.
export { SpanStatusCode } from "@opentelemetry/api";

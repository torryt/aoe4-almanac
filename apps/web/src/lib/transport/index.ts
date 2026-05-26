import { httpEventBus, httpTransport } from "./http.ts";
import { invokeEventBus, invokeTransport } from "./invoke.ts";
import type { EventBus, Transport } from "./types.ts";

export { TransportError } from "./types.ts";
export type { EventBus, HttpMethod, SyncEventPayload, Transport, Unsubscribe } from "./types.ts";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const transport: Transport = isTauri() ? invokeTransport : httpTransport;
export const eventBus: EventBus = isTauri() ? invokeEventBus : httpEventBus;
export const runtime: "tauri" | "web" = isTauri() ? "tauri" : "web";

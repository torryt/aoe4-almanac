export function log(reqId: string | undefined, msg: string): void {
  const tag = reqId ? `[req ${reqId}] ` : "";
  // eslint-disable-next-line no-console
  console.log(`${tag}${msg}`);
}

export function logError(reqId: string | undefined, msg: string, err?: unknown): void {
  const tag = reqId ? `[req ${reqId}] ` : "";
  // eslint-disable-next-line no-console
  console.error(`${tag}${msg}`, err ?? "");
}

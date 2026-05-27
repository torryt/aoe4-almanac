import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; update: Update }
  | { phase: "downloading"; update: Update; downloaded: number; total: number | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export function useUpdater(opts: { checkOnMount?: boolean } = {}) {
  const { checkOnMount = true } = opts;
  const [state, setState] = useState<UpdaterState>({ phase: "idle" });

  async function runCheck() {
    setState({ phase: "checking" });
    try {
      const update = await check();
      if (update) {
        setState({ phase: "available", update });
      } else {
        setState({ phase: "idle" });
      }
    } catch (e) {
      setState({ phase: "error", message: stringifyError(e) });
    }
  }

  async function install() {
    if (state.phase !== "available") return;
    const update = state.update;
    let downloaded = 0;
    let total: number | null = null;
    setState({ phase: "downloading", update, downloaded, total });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setState({ phase: "downloading", update, downloaded, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState({ phase: "downloading", update, downloaded, total });
        } else if (event.event === "Finished") {
          setState({ phase: "ready" });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: stringifyError(e) });
    }
  }

  useEffect(() => {
    if (!checkOnMount) return;
    void runCheck();
  }, [checkOnMount]);

  return { state, check: runCheck, install };
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

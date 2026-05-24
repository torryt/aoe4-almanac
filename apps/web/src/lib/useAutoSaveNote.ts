import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api, qk, type UserPreferences } from "./api.ts";

const AUTO_SAVE_DEBOUNCE_MS = 800;

export type AutoSaveStatus = "idle" | "dirty" | "saving" | "saved";

export function useUserPreferences() {
  return useQuery({
    queryKey: qk.preferences,
    queryFn: () => api.get<UserPreferences>("/me/preferences"),
    staleTime: 60_000,
  });
}

export function useAutoSaveNote(opts: {
  draft: string;
  savedBody: string;
  isSaving: boolean;
  save: (body: string) => void;
}): {
  autoSaveEnabled: boolean;
  status: AutoSaveStatus;
  flush: () => void;
} {
  const prefs = useUserPreferences();
  const autoSaveEnabled = prefs.data?.auto_save_notes ?? true;

  const dirty = opts.draft !== opts.savedBody;
  const status: AutoSaveStatus = opts.isSaving
    ? "saving"
    : dirty
      ? "dirty"
      : "saved";

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Use refs to keep flush stable while always saving the latest draft.
  const draftRef = useRef(opts.draft);
  const savedRef = useRef(opts.savedBody);
  const saveRef = useRef(opts.save);
  draftRef.current = opts.draft;
  savedRef.current = opts.savedBody;
  saveRef.current = opts.save;

  function cancelTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function flush() {
    cancelTimer();
    if (draftRef.current !== savedRef.current) {
      saveRef.current(draftRef.current);
    }
  }

  useEffect(() => {
    if (!autoSaveEnabled) {
      cancelTimer();
      return;
    }
    if (!dirty) {
      cancelTimer();
      return;
    }
    cancelTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (draftRef.current !== savedRef.current) {
        saveRef.current(draftRef.current);
      }
    }, AUTO_SAVE_DEBOUNCE_MS);
    return cancelTimer;
  }, [autoSaveEnabled, dirty, opts.draft]);

  // Save on unmount / page hide if there are unsaved edits.
  useEffect(() => {
    function onHide() {
      if (autoSaveEnabled) flush();
    }
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (autoSaveEnabled && draftRef.current !== savedRef.current) {
        saveRef.current(draftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveEnabled]);

  return { autoSaveEnabled, status, flush };
}

export function autoSaveStatusLabel(
  status: AutoSaveStatus,
  hasEverSaved: boolean,
): string {
  if (status === "saving") return "Saving…";
  if (status === "dirty") return "Unsaved";
  if (hasEverSaved) return "Saved";
  return "";
}

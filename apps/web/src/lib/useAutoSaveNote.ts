import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

// Owns the textarea draft so that hydration from the server query and
// auto-save can be coordinated. Two failure modes this guards against:
//   1. An empty save firing on mount before draft has been hydrated from
//      a cached query result — the unmount/StrictMode cleanup would otherwise
//      compare draft="" against savedBody="<your notes>" and PUT "".
//   2. The refetch that follows our own save round-tripping the just-saved
//      body and overwriting newer characters the user typed while in flight.
export function useAutoSaveNote(opts: {
  serverBody: string | undefined;
  isSaving: boolean;
  save: (body: string) => void;
}): {
  draft: string;
  setDraft: (v: string) => void;
  autoSaveEnabled: boolean;
  status: AutoSaveStatus;
  dirty: boolean;
  hydrated: boolean;
  flush: () => void;
} {
  const prefs = useUserPreferences();
  const autoSaveEnabled = prefs.data?.auto_save_notes ?? true;

  const [draft, setDraftState] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const lastServerBodyRef = useRef<string | undefined>(undefined);
  const interactedRef = useRef(false);

  useEffect(() => {
    const sb = opts.serverBody;
    if (sb === undefined) return;
    if (!hydrated) {
      // First time the server body is known. Preserve any text the user
      // already typed before the network resolved.
      if (!interactedRef.current) setDraftState(sb);
      lastServerBodyRef.current = sb;
      setHydrated(true);
      return;
    }
    // Subsequent server changes (our own save echoing back, or an external
    // edit). Only adopt the new value if the user has no local divergence
    // from the previous server value, otherwise we'd undo in-flight typing.
    if (lastServerBodyRef.current !== sb) {
      setDraftState((prev) =>
        prev === lastServerBodyRef.current ? sb : prev,
      );
      lastServerBodyRef.current = sb;
    }
  }, [opts.serverBody, hydrated]);

  const savedBody = opts.serverBody ?? "";
  const dirty = hydrated && draft !== savedBody;
  const status: AutoSaveStatus = opts.isSaving
    ? "saving"
    : dirty
      ? "dirty"
      : "saved";

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  const savedRef = useRef(savedBody);
  const saveRef = useRef(opts.save);
  draftRef.current = draft;
  savedRef.current = savedBody;
  saveRef.current = opts.save;

  function cancelTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function flush() {
    cancelTimer();
    if (
      interactedRef.current &&
      draftRef.current !== savedRef.current
    ) {
      saveRef.current(draftRef.current);
    }
  }

  function setDraft(v: string) {
    interactedRef.current = true;
    setDraftState(v);
  }

  useEffect(() => {
    if (!autoSaveEnabled) {
      cancelTimer();
      return;
    }
    if (!interactedRef.current || !dirty) {
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
  }, [autoSaveEnabled, dirty, draft]);

  useEffect(() => {
    function onHide() {
      if (autoSaveEnabled) flush();
    }
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (
        autoSaveEnabled &&
        interactedRef.current &&
        draftRef.current !== savedRef.current
      ) {
        saveRef.current(draftRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveEnabled]);

  return {
    draft,
    setDraft,
    autoSaveEnabled,
    status,
    dirty,
    hydrated,
    flush,
  };
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
